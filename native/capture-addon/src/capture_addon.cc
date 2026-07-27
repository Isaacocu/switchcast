/**
 * capture_addon.cc — SwitchCast 原生采集模块 N-API 注册层
 *
 * 纯 C++ 文件，不包含任何 Objective-C 头文件。
 * 通过 extern "C" 声明调用 capture_bridge.mm 中的 C 接口函数，
 * 实现 AVFoundation 采集 + Metal 零拷贝渲染的桥接。
 *
 * 职责：
 *   - 初始化 N-API 模块，注册 JS 可调用方法
 *   - 创建 threadsafe function 用于跨线程回调（stats / error）
 *   - 将 tsfn 引用传递给 Obj-C++ bridge 层
 *   - destroy() 时释放 tsfn 避免进程退出挂起
 */

#include <node_api.h>
#include <cstring>
#include <cstdlib>
#include <string>

// ==========================================================================
//  extern "C" 接口声明（实现位于 capture_bridge.mm）
// ==========================================================================

extern "C" {
    /// 设置 threadsafe function 回调引用（由 bridge 层持有并调用）
    void set_callbacks(napi_threadsafe_function statsTsfn,
                       napi_threadsafe_function errorTsfn);

    /// 创建采集会话（AVCaptureSession + Metal 管线）
    bool create_capture_session(const char* deviceID,
                                int width, int height, int frameRate);

    /// 将 CAMetalLayer 附加到 Electron 窗口的 NSView
    bool attach_to_window(void* nsViewPtr);

    /// 启动采集
    bool start_capture();

    /// 停止采集
    void stop_capture();

    /// 设置 Metal 层帧矩形（窗口大小变化时由 Electron 侧调用）
    void set_frame_rect(float x, float y, float width, float height);

    /// 销毁所有资源（AVFoundation + Metal + CAMetalLayer）
    void destroy_capture();

    /// 枚举视频设备，返回 JSON 字符串
    const char* list_video_devices();
}

// ==========================================================================
//  静态 threadsafe function 引用
// ==========================================================================

static napi_threadsafe_function sStatsTsfn = nullptr;
static napi_threadsafe_function sErrorTsfn = nullptr;

// ==========================================================================
//  threadsafe function 的 call_js 回调
//  这些回调在 Node.js 主线程上执行，负责将 C 数据转换为 JS 值
// ==========================================================================

/**
 * stats 回调：data 是 double[2]，[0]=latencyMs, [1]=fps
 * 在 JS 主线程执行，构造 { latency, fps } 对象并调用 JS 回调
 */
static void CallStatsJs(napi_env env, napi_value js_cb,
                        void* /*context*/, void* data) {
    if (js_cb == nullptr || data == nullptr) return;

    double* stats = static_cast<double*>(data);

    // 构造 JS 对象 { latency: number, fps: number }
    napi_value obj;
    napi_create_object(env, &obj);

    napi_value latency_val;
    napi_create_double(env, stats[0], &latency_val);
    napi_set_named_property(env, obj, "latency", latency_val);

    napi_value fps_val;
    napi_create_double(env, stats[1], &fps_val);
    napi_set_named_property(env, obj, "fps", fps_val);

    // 调用 JS 回调
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    napi_call_function(env, undefined, js_cb, 1, &obj, nullptr);

    // 释放数据（由 bridge 层 new[] 分配）
    delete[] stats;
}

/**
 * error 回调：data 是 char* 字符串（由 bridge 层 new[] 分配）
 */
static void CallErrorJs(napi_env env, napi_value js_cb,
                        void* /*context*/, void* data) {
    if (js_cb == nullptr || data == nullptr) return;

    char* message = static_cast<char*>(data);

    napi_value msg_val;
    napi_create_string_utf8(env, message, NAPI_AUTO_LENGTH, &msg_val);

    napi_value undefined;
    napi_get_undefined(env, &undefined);
    napi_call_function(env, undefined, js_cb, 1, &msg_val, nullptr);

    // 释放数据
    delete[] message;
}

/**
 * tsfn 终结化回调（tsfn 被释放时调用，目前无需额外清理）
 */
static void TsfnFinalize(napi_env /*env*/, void* /*finalize_data*/,
                         void* /*finalize_hint*/) {
    // 无操作
}

// ==========================================================================
//  辅助函数
// ==========================================================================

/// 从 napi_value 获取 UTF-8 字符串
static std::string NapiToString(napi_env env, napi_value value) {
    if (value == nullptr) {
        return "";
    }
    size_t len = 0;
    napi_status status = napi_get_value_string_utf8(env, value, nullptr, 0, &len);
    if (status != napi_ok) {
        return "";
    }
    std::string str(len, '\0');
    napi_get_value_string_utf8(env, value, &str[0], len + 1, &len);
    return str;
}

// ==========================================================================
//  N-API 方法实现
// ==========================================================================

/**
 * create(options) — 创建采集会话
 * options: { deviceID: string, width: number, height: number, frameRate: number }
 * 返回: boolean
 */
static napi_value MethodCreate(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1];
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

    if (argc < 1) {
        napi_throw_type_error(env, nullptr, "create 需要 options 参数");
        return nullptr;
    }

    // 从 options 对象提取字段
    napi_value deviceID_val, width_val, height_val, frameRate_val;
    napi_get_named_property(env, args[0], "deviceID", &deviceID_val);
    napi_get_named_property(env, args[0], "width", &width_val);
    napi_get_named_property(env, args[0], "height", &height_val);
    napi_get_named_property(env, args[0], "frameRate", &frameRate_val);

    std::string deviceID = NapiToString(env, deviceID_val);

    int32_t width = 0, height = 0, frameRate = 0;
    napi_get_value_int32(env, width_val, &width);
    napi_get_value_int32(env, height_val, &height);
    napi_get_value_int32(env, frameRate_val, &frameRate);

    bool result = create_capture_session(deviceID.c_str(), width, height, frameRate);

    napi_value ret;
    napi_get_boolean(env, result, &ret);
    return ret;
}

/**
 * attachToWindow(nsViewHandle) — 将 CAMetalLayer 附加到 Electron 窗口的 NSView
 * nsViewHandle: Buffer（由 Electron 的 win.getNativeWindowHandle() 返回）
 * 返回: boolean
 */
static napi_value MethodAttachToWindow(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1];
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

    if (argc < 1) {
        napi_throw_type_error(env, nullptr, "attachToWindow 需要 nsViewHandle 参数");
        return nullptr;
    }

    // 从 Buffer 提取 NSView 指针
    // Electron 的 getNativeWindowHandle() 返回包含原始指针字节的 Buffer
    void* nsViewPtr = nullptr;
    void* buf_data = nullptr;
    size_t buf_len = 0;

    // 优先尝试 Node.js Buffer
    napi_status status = napi_get_buffer_info(env, args[0], &buf_data, &buf_len);
    if (status != napi_ok) {
        // 回退到 ArrayBuffer
        status = napi_get_arraybuffer_info(env, args[0], &buf_data, &buf_len);
    }

    if (status == napi_ok && buf_data != nullptr && buf_len >= sizeof(void*)) {
        // 安全拷贝指针值
        memcpy(&nsViewPtr, buf_data, sizeof(void*));
    }

    bool result = false;
    if (nsViewPtr != nullptr) {
        result = attach_to_window(nsViewPtr);
    }

    napi_value ret;
    napi_get_boolean(env, result, &ret);
    return ret;
}

/**
 * start() — 启动采集
 * 返回: boolean
 */
static napi_value MethodStart(napi_env env, napi_callback_info info) {
    bool result = start_capture();

    napi_value ret;
    napi_get_boolean(env, result, &ret);
    return ret;
}

/**
 * stop() — 停止采集
 */
static napi_value MethodStop(napi_env env, napi_callback_info info) {
    stop_capture();

    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
}

/**
 * setFrameRect(x, y, width, height) — 设置 Metal 层帧矩形
 * 由 Electron 侧在窗口大小变化时调用
 */
static napi_value MethodSetFrameRect(napi_env env, napi_callback_info info) {
    size_t argc = 4;
    napi_value args[4];
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

    if (argc < 4) {
        napi_throw_type_error(env, nullptr, "setFrameRect 需要 x, y, width, height 四个参数");
        return nullptr;
    }

    double x = 0, y = 0, width = 0, height = 0;
    napi_get_value_double(env, args[0], &x);
    napi_get_value_double(env, args[1], &y);
    napi_get_value_double(env, args[2], &width);
    napi_get_value_double(env, args[3], &height);

    set_frame_rect(static_cast<float>(x), static_cast<float>(y),
                   static_cast<float>(width), static_cast<float>(height));

    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
}

/**
 * destroy() — 清理所有资源
 * 必须释放 threadsafe function 避免进程退出挂起
 */
static napi_value MethodDestroy(napi_env env, napi_callback_info info) {
    // 先销毁 bridge 侧资源（AVFoundation / Metal / CAMetalLayer）
    destroy_capture();

    // 释放 threadsafe functions（使用 abort 模式，阻止后续调用）
    if (sStatsTsfn != nullptr) {
        napi_release_threadsafe_function(sStatsTsfn, napi_tsfn_abort);
        sStatsTsfn = nullptr;
    }
    if (sErrorTsfn != nullptr) {
        napi_release_threadsafe_function(sErrorTsfn, napi_tsfn_abort);
        sErrorTsfn = nullptr;
    }

    // 清除 bridge 侧的回调引用
    set_callbacks(nullptr, nullptr);

    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
}

/**
 * on(event, callback) — 注册事件回调
 * event: 'stats' | 'error'
 * callback: (data) => void
 *
 * 使用 threadsafe function 实现跨线程回调，
 * 采集线程（GCD queue）可以安全地调用 JS 回调。
 */
static napi_value MethodOn(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value args[2];
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

    if (argc < 2) {
        napi_throw_type_error(env, nullptr, "on 需要 event 和 callback 两个参数");
        return nullptr;
    }

    std::string event = NapiToString(env, args[0]);

    if (event == "stats") {
        // 如果已存在旧回调，先释放
        if (sStatsTsfn != nullptr) {
            napi_release_threadsafe_function(sStatsTsfn, napi_tsfn_abort);
            sStatsTsfn = nullptr;
        }

        napi_value work_name;
        napi_create_string_utf8(env, "capture-stats-callback",
                                NAPI_AUTO_LENGTH, &work_name);

        napi_create_threadsafe_function(
            env,
            args[1],          // JS 回调函数
            nullptr,          // async_resource（可选）
            work_name,        // async_resource_name（用于诊断）
            CallStatsJs,      // call_js_callback
            0,                // max_queue_size（0 = 不限制）
            1,                // initial_thread_count（采集线程 = 1）
            nullptr,          // finalize_data
            TsfnFinalize,     // finalize_callback
            nullptr,          // context
            &sStatsTsfn       // 输出：threadsafe function
        );

        // 将 tsfn 引用传递给 bridge 层
        set_callbacks(sStatsTsfn, sErrorTsfn);

    } else if (event == "error") {
        // 如果已存在旧回调，先释放
        if (sErrorTsfn != nullptr) {
            napi_release_threadsafe_function(sErrorTsfn, napi_tsfn_abort);
            sErrorTsfn = nullptr;
        }

        napi_value work_name;
        napi_create_string_utf8(env, "capture-error-callback",
                                NAPI_AUTO_LENGTH, &work_name);

        napi_create_threadsafe_function(
            env,
            args[1],          // JS 回调函数
            nullptr,          // async_resource
            work_name,        // async_resource_name
            CallErrorJs,      // call_js_callback
            0,                // max_queue_size
            1,                // initial_thread_count
            nullptr,          // finalize_data
            TsfnFinalize,     // finalize_callback
            nullptr,          // context
            &sErrorTsfn       // 输出
        );

        set_callbacks(sStatsTsfn, sErrorTsfn);

    } else {
        napi_throw_type_error(env, nullptr,
            "不支持的事件类型，仅支持 'stats' 和 'error'");
        return nullptr;
    }

    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
}

/**
 * listVideoDevices() — 枚举视频设备
 * 返回: string（JSON 格式，由 JS 包装层 JSON.parse 为数组）
 */
static napi_value MethodListVideoDevices(napi_env env, napi_callback_info info) {
    const char* json = list_video_devices();

    napi_value result;
    if (json != nullptr && json[0] != '\0') {
        napi_create_string_utf8(env, json, NAPI_AUTO_LENGTH, &result);
    } else {
        napi_create_string_utf8(env, "[]", NAPI_AUTO_LENGTH, &result);
    }
    return result;
}

// ==========================================================================
//  模块初始化
// ==========================================================================

static napi_value Init(napi_env env, napi_value exports) {
    napi_property_descriptor descriptors[] = {
        {"create",          nullptr, MethodCreate,          nullptr, nullptr, nullptr, napi_default, nullptr},
        {"attachToWindow",  nullptr, MethodAttachToWindow,  nullptr, nullptr, nullptr, napi_default, nullptr},
        {"start",           nullptr, MethodStart,           nullptr, nullptr, nullptr, napi_default, nullptr},
        {"stop",            nullptr, MethodStop,            nullptr, nullptr, nullptr, napi_default, nullptr},
        {"setFrameRect",    nullptr, MethodSetFrameRect,    nullptr, nullptr, nullptr, napi_default, nullptr},
        {"destroy",         nullptr, MethodDestroy,         nullptr, nullptr, nullptr, napi_default, nullptr},
        {"on",              nullptr, MethodOn,              nullptr, nullptr, nullptr, napi_default, nullptr},
        {"listVideoDevices",nullptr, MethodListVideoDevices,nullptr, nullptr, nullptr, napi_default, nullptr},
    };

    napi_define_properties(env, exports,
        sizeof(descriptors) / sizeof(descriptors[0]),
        descriptors);

    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
