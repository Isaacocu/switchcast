/**
 * capture_bridge.mm — SwitchCast 原生采集模块 Obj-C++ 实现层
 *
 * 核心职责：
 *   1. AVFoundation 视频采集（AVCaptureSession + AVCaptureVideoDataOutput）
 *   2. Metal 零拷贝渲染（CVMetalTextureCache → MTLTexture → CAMetalLayer）
 *   3. CAMetalLayer 叠加到 Electron 窗口的 NSView
 *   4. PTS 延迟测量（mach_absolute_time）
 *   5. 通过 threadsafe function 上报 stats/error 回调
 *
 * 对标 OBS mac-avcapture 插件，实现低延迟采集与渲染。
 */

#import <AVFoundation/AVFoundation.h>
#import <Metal/Metal.h>
#import <CoreVideo/CoreVideo.h>
#import <CoreMedia/CoreMedia.h>
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <mach/mach_time.h>
#include <node_api.h>
#include <cstring>
#include <cstdio>

// 前向声明采集委托类
@class CaptureDelegate;

// ==========================================================================
//  全局状态
// ==========================================================================

// AVFoundation 采集
static AVCaptureSession *sSession = nil;
static AVCaptureVideoDataOutput *sOutput = nil;
static dispatch_queue_t sCaptureQueue = nil;

// Metal 渲染
static id<MTLDevice> sDevice = nil;
static id<MTLCommandQueue> sCommandQueue = nil;
static CVMetalTextureCacheRef sTextureCache = NULL;
static CAMetalLayer *sMetalLayer = nil;
static id<MTLRenderPipelineState> sPipeline = nil;
static id<MTLBuffer> sVertexBuffer = nil;  // 未使用（shader 使用 vertex_id 生成全屏三角形）

// PTS 测量
static mach_timebase_info_data_t sTimebaseInfo;
static uint64_t sCaptureTimestamp = 0;

// FPS 统计
static int sFrameCount = 0;
static uint64_t sLastFpsTime = 0;
static double sCurrentFps = 0.0;

// threadsafe function 引用（由 capture_addon.cc 传入）
static napi_threadsafe_function sStatsTsfn = nullptr;
static napi_threadsafe_function sErrorTsfn = nullptr;

// 采集委托实例
static CaptureDelegate *sDelegate = nil;

// ==========================================================================
//  Metal Shader 源码（MSL）
//  顶点着色器：使用 vertex_id 生成全屏三角形（无需顶点缓冲区）
//  片元着色器：采样 NV12 双平面纹理，BT.601 YCbCr→RGB 转换
// ==========================================================================

static const char *kShaderSource = R"METAL(
#include <metal_stdlib>
using namespace metal;

// 顶点输出结构
struct VertexOut {
    float4 position [[position]];
    float2 uv;
};

// 顶点着色器：全屏三角形
// 使用 vertex_id 生成 3 个顶点覆盖整个屏幕，无需顶点缓冲区
vertex VertexOut vertex_main(uint vertex_id [[vertex_id]]) {
    // 生成 (0,0), (2,0), (0,2) 三角形覆盖 [-1,1] 裁剪空间
    float2 pos = float2((vertex_id << 1) & 2, vertex_id & 2);
    VertexOut out;
    out.position = float4(pos * 2.0 - 1.0, 0.0, 1.0);
    // Y 翻转：Metal 纹理原点在左上，UV 原点在左下
    out.uv = float2(pos.x, 1.0 - pos.y);
    return out;
}

// 片元着色器：NV12 YCbCr → RGB 转换（BT.601）
fragment float4 fragment_main(
    VertexOut in [[stage_in]],
    texture2d<float, access::sample> texY  [[texture(0)]],
    texture2d<float, access::sample> texUV [[texture(1)]]
) {
    constexpr sampler s(filter::linear, address::clamp_to_edge);
    // 采样 Y 分量
    float y = texY.sample(s, in.uv).r;
    // 采样 UV 分量（交错格式，居中到 [-0.5, 0.5]）
    float2 uv = texUV.sample(s, in.uv).rg - 0.5;
    // BT.601 YCbCr → RGB 转换矩阵
    float r = y + 1.402 * uv.x;
    float g = y - 0.344 * uv.x - 0.714 * uv.y;
    float b = y + 1.772 * uv.y;
    return float4(r, g, b, 1.0);
}
)METAL";

// ==========================================================================
//  辅助函数
// ==========================================================================

/// 通过 threadsafe function 上报统计数据（FPS + 延迟）
/// data 由 new[] 分配，由 call_js 回调 delete[] 释放
static void report_stats(double latencyMs, double fps) {
    if (sStatsTsfn != nullptr) {
        double *data = new double[2];
        data[0] = latencyMs;
        data[1] = fps;
        napi_status status = napi_call_threadsafe_function(
            sStatsTsfn, data, napi_tsfn_nonblocking);
        if (status == napi_closing) {
            // tsfn 已关闭，释放数据避免泄漏
            delete[] data;
            sStatsTsfn = nullptr;
        }
    }
}

/// 通过 threadsafe function 上报错误信息
/// data 由 new[] 分配，由 call_js 回调 delete[] 释放
static void report_error(const char *message) {
    if (sErrorTsfn != nullptr) {
        size_t len = strlen(message);
        char *data = new char[len + 1];
        memcpy(data, message, len + 1);
        napi_status status = napi_call_threadsafe_function(
            sErrorTsfn, data, napi_tsfn_nonblocking);
        if (status == napi_closing) {
            delete[] data;
            sErrorTsfn = nullptr;
        }
    } else {
        // tsfn 未设置，输出到 stderr 作为后备
        fprintf(stderr, "[capture-addon] %s\n", message);
    }
}

// ==========================================================================
//  采集委托类 — 接收 AVCaptureVideoDataOutput 的帧回调
// ==========================================================================

@interface CaptureDelegate : NSObject <AVCaptureVideoDataOutputSampleBufferDelegate>
@end

@implementation CaptureDelegate

/**
 * 采集回调：每帧调用
 * 在 sCaptureQueue 上执行，实现零拷贝 Metal 渲染
 */
- (void)captureOutput:(AVCaptureOutput *)output
   didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
        fromConnection:(AVCaptureConnection *)connection {

    // 记录采集时间戳（PTS 起点）
    sCaptureTimestamp = mach_absolute_time();

    // 获取像素缓冲区
    CVPixelBufferRef pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer);
    if (!pixelBuffer) return;

    int width = (int)CVPixelBufferGetWidth(pixelBuffer);
    int height = (int)CVPixelBufferGetHeight(pixelBuffer);
    if (width == 0 || height == 0) return;

    // ================================================================
    //  NV12 双平面 → 两个 MTLTexture（零拷贝）
    //  Plane 0: Y  分量, R8Unorm,  全尺寸
    //  Plane 1: UV 交错, RG8Unorm, 半尺寸
    // ================================================================
    CVMetalTextureRef cvTexY = NULL;
    CVMetalTextureRef cvTexUV = NULL;

    CVReturn statusY = CVMetalTextureCacheCreateTextureFromImage(
        kCFAllocatorDefault, sTextureCache, pixelBuffer, nil,
        MTLPixelFormatR8Unorm, width, height, 0, &cvTexY);

    CVReturn statusUV = CVMetalTextureCacheCreateTextureFromImage(
        kCFAllocatorDefault, sTextureCache, pixelBuffer, nil,
        MTLPixelFormatRG8Unorm, width / 2, height / 2, 1, &cvTexUV);

    if (statusY != kCVReturnSuccess || statusUV != kCVReturnSuccess) {
        if (cvTexY) CVBufferRelease(cvTexY);
        if (cvTexUV) CVBufferRelease(cvTexUV);
        return;
    }

    id<MTLTexture> texY = CVMetalTextureGetTexture(cvTexY);
    id<MTLTexture> texUV = CVMetalTextureGetTexture(cvTexUV);

    // ================================================================
    //  渲染到 CAMetalLayer
    // ================================================================
    if (texY && texUV && sMetalLayer && sPipeline && sCommandQueue) {
        id<CAMetalDrawable> drawable = [sMetalLayer nextDrawable];
        if (drawable) {
            id<MTLCommandBuffer> cmdBuffer = [sCommandQueue commandBuffer];

            MTLRenderPassDescriptor *passDesc =
                [MTLRenderPassDescriptor renderPassDescriptor];
            passDesc.colorAttachments[0].texture = drawable.texture;
            passDesc.colorAttachments[0].loadAction = MTLLoadActionDontCare;
            passDesc.colorAttachments[0].storeAction = MTLStoreActionStore;

            id<MTLRenderCommandEncoder> encoder =
                [cmdBuffer renderCommandEncoderWithDescriptor:passDesc];
            [encoder setRenderPipelineState:sPipeline];
            [encoder setFragmentTexture:texY atIndex:0];
            [encoder setFragmentTexture:texUV atIndex:1];
            // 全屏三角形，无需顶点缓冲区（shader 使用 vertex_id）
            [encoder drawPrimitives:MTLPrimitiveTypeTriangle
                        vertexStart:0
                        vertexCount:3];
            [encoder endEncoding];

            [cmdBuffer presentDrawable:drawable];
            [cmdBuffer commit];
        }
    }

    // 释放 CVMetalTexture 引用（MTLTexture 由 ARC 管理）
    CVBufferRelease(cvTexY);
    CVBufferRelease(cvTexUV);

    // ================================================================
    //  PTS 延迟测量 + FPS 统计
    // ================================================================
    uint64_t renderTs = mach_absolute_time();
    double latencyMs = (double)(renderTs - sCaptureTimestamp)
                       * sTimebaseInfo.numer
                       / sTimebaseInfo.denom
                       / 1e6;

    // FPS 统计（每秒更新一次）
    sFrameCount++;
    double elapsed = (double)(renderTs - sLastFpsTime)
                     * sTimebaseInfo.numer
                     / sTimebaseInfo.denom
                     / 1e9;
    if (elapsed >= 1.0) {
        sCurrentFps = (double)sFrameCount / elapsed;
        sFrameCount = 0;
        sLastFpsTime = renderTs;

        // 上报 stats（FPS + 本帧延迟）
        report_stats(latencyMs, sCurrentFps);
    }
}

/**
 * 丢帧回调
 */
- (void)captureOutput:(AVCaptureOutput *)output
   didDropSampleBuffer:(CMSampleBufferRef)sampleBuffer
        fromConnection:(AVCaptureConnection *)connection {
    // 丢帧时不做处理，由 alwaysDiscardsLateVideoFrames=YES 控制
}

@end

// ==========================================================================
//  C 接口函数实现（供 capture_addon.cc 调用）
// ==========================================================================

extern "C" {

/// 设置 threadsafe function 回调引用
void set_callbacks(napi_threadsafe_function statsTsfn,
                   napi_threadsafe_function errorTsfn) {
    sStatsTsfn = statsTsfn;
    sErrorTsfn = errorTsfn;
}

/// 创建采集会话（AVCaptureSession + Metal 管线 + CAMetalLayer）
bool create_capture_session(const char *deviceID, int width, int height,
                            int frameRate) {
    // 如果已有会话，拒绝创建
    if (sSession) {
        report_error("采集会话已存在，请先调用 destroy()");
        return false;
    }

    @autoreleasepool {
        // 初始化 timebase（用于 PTS 延迟测量）
        mach_timebase_info(&sTimebaseInfo);

        // ---- Metal 设备初始化 ----
        sDevice = MTLCreateSystemDefaultDevice();
        if (!sDevice) {
            report_error("无法创建 Metal 设备");
            return false;
        }

        sCommandQueue = [sDevice newCommandQueue];
        if (!sCommandQueue) {
            report_error("无法创建 Metal 命令队列");
            return false;
        }

        // 创建纹理缓存（零拷贝关键：CVPixelBuffer → MTLTexture）
        CVReturn cvStatus = CVMetalTextureCacheCreate(
            kCFAllocatorDefault, nil, sDevice, nil, &sTextureCache);
        if (cvStatus != kCVReturnSuccess) {
            report_error("无法创建 Metal 纹理缓存");
            return false;
        }

        // ---- CAMetalLayer 创建 ----
        sMetalLayer = [CAMetalLayer layer];
        sMetalLayer.device = sDevice;
        sMetalLayer.pixelFormat = MTLPixelFormatBGRA8Unorm;
        sMetalLayer.framebufferOnly = YES;        // 仅渲染目标，性能优化
        sMetalLayer.presentsWithTransaction = NO; // 异步呈现，避免撕裂

        // ---- Metal Shader 编译 ----
        NSString *source = [NSString stringWithUTF8String:kShaderSource];
        MTLCompileOptions *compileOptions = [[MTLCompileOptions alloc] init];
        NSError *shaderError = nil;
        id<MTLLibrary> library = [sDevice newLibraryWithSource:source
                                                       options:compileOptions
                                                         error:&shaderError];
        if (!library) {
            if (shaderError) {
                report_error([shaderError.localizedDescription UTF8String]);
            } else {
                report_error("Metal shader 编译失败（未知错误）");
            }
            return false;
        }

        id<MTLFunction> vertexFunc =
            [library newFunctionWithName:@"vertex_main"];
        id<MTLFunction> fragmentFunc =
            [library newFunctionWithName:@"fragment_main"];

        if (!vertexFunc || !fragmentFunc) {
            report_error("无法获取 Metal shader 函数");
            return false;
        }

        // ---- 渲染管线创建 ----
        MTLRenderPipelineDescriptor *pipelineDesc =
            [[MTLRenderPipelineDescriptor alloc] init];
        pipelineDesc.vertexFunction = vertexFunc;
        pipelineDesc.fragmentFunction = fragmentFunc;
        pipelineDesc.colorAttachments[0].pixelFormat = MTLPixelFormatBGRA8Unorm;

        NSError *pipelineError = nil;
        sPipeline = [sDevice newRenderPipelineStateWithDescriptor:pipelineDesc
                                                            error:&pipelineError];
        if (!sPipeline) {
            if (pipelineError) {
                report_error([pipelineError.localizedDescription UTF8String]);
            } else {
                report_error("渲染管线创建失败（未知错误）");
            }
            return false;
        }

        // ---- AVCaptureSession 配置 ----
        sSession = [[AVCaptureSession alloc] init];
        sSession.sessionPreset = AVCaptureSessionPreset1920x1080;

        // 按 deviceID 查找设备
        NSString *nsDeviceID = [NSString stringWithUTF8String:deviceID];
        AVCaptureDevice *device =
            [AVCaptureDevice deviceWithUniqueID:nsDeviceID];
        if (!device) {
            report_error("找不到指定的视频设备");
            return false;
        }

        // 创建设备输入
        NSError *inputError = nil;
        AVCaptureDeviceInput *input =
            [AVCaptureDeviceInput deviceInputWithDevice:device error:&inputError];
        if (inputError) {
            report_error([inputError.localizedDescription UTF8String]);
            return false;
        }
        if (![sSession canAddInput:input]) {
            report_error("无法添加设备输入到会话");
            return false;
        }
        [sSession addInput:input];

        // 创建视频数据输出
        sOutput = [[AVCaptureVideoDataOutput alloc] init];
        sOutput.alwaysDiscardsLateVideoFrames = YES;

        // NV12 格式（双平面 YCbCr 4:2:0）+ IOSurface 支持（Metal 零拷贝必需）
        NSDictionary *videoSettings = @{
            (id)kCVPixelBufferPixelFormatTypeKey:
                @(kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange),
            (id)kCVPixelBufferIOSurfacePropertiesKey: @{}
        };
        sOutput.videoSettings = videoSettings;

        // 创建采集队列和委托
        sCaptureQueue =
            dispatch_queue_create("com.switchcast.capture", DISPATCH_QUEUE_SERIAL);
        sDelegate = [[CaptureDelegate alloc] init];

        [sOutput setSampleBufferDelegate:sDelegate queue:sCaptureQueue];

        if (![sSession canAddOutput:sOutput]) {
            report_error("无法添加视频输出到会话");
            return false;
        }
        [sSession addOutput:sOutput];

        // 配置帧率（在添加 output 之后才能获取 connection）
        AVCaptureConnection *conn =
            [sOutput connectionWithMediaType:AVMediaTypeVideo];
        if (conn && frameRate > 0) {
            if ([conn isVideoMinFrameDurationSupported]) {
                conn.videoMinFrameDuration = CMTimeMake(1, frameRate);
            }
            if ([conn isVideoMaxFrameDurationSupported]) {
                conn.videoMaxFrameDuration = CMTimeMake(1, frameRate);
            }
        }

        return true;
    }
}

/// 将 CAMetalLayer 附加到 Electron 窗口的 NSView
bool attach_to_window(void *nsViewPtr) {
    if (!sMetalLayer) {
        report_error("Metal 层未创建，请先调用 create()");
        return false;
    }

    @autoreleasepool {
        NSView *nsView = (__bridge NSView *)nsViewPtr;
        if (!nsView) {
            report_error("无效的 NSView 指针");
            return false;
        }

        // 确保 NSView 支持图层
        if (!nsView.wantsLayer) {
            nsView.wantsLayer = YES;
        }

        // 添加 Metal 层作为子层
        [nsView.layer addSublayer:sMetalLayer];

        // 初始帧矩形匹配 NSView 边界
        sMetalLayer.frame = nsView.bounds;

        return true;
    }
}

/// 启动采集
bool start_capture() {
    if (!sSession) {
        report_error("采集会话未创建");
        return false;
    }

    // 重置 FPS 统计
    sFrameCount = 0;
    sLastFpsTime = mach_absolute_time();
    sCurrentFps = 0.0;

    // 在 capture queue 上启动（startRunning 是同步调用，避免阻塞主线程）
    dispatch_async(sCaptureQueue, ^{
        [sSession startRunning];
    });

    return true;
}

/// 停止采集
void stop_capture() {
    // 先断开委托，防止新帧回调
    if (sOutput) {
        [sOutput setSampleBufferDelegate:nil queue:nil];
    }
    if (sSession) {
        dispatch_async(sCaptureQueue, ^{
            [sSession stopRunning];
        });
    }
}

/// 设置 Metal 层帧矩形（窗口大小变化时由 Electron 侧调用）
void set_frame_rect(float x, float y, float width, float height) {
    if (!sMetalLayer) return;

    // 在主线程执行 UI 操作
    dispatch_async(dispatch_get_main_queue(), ^{
        sMetalLayer.frame = CGRectMake(x, y, width, height);
    });
}

/// 销毁所有资源
void destroy_capture() {
    // 先断开委托，防止新帧回调
    if (sOutput) {
        [sOutput setSampleBufferDelegate:nil queue:nil];
    }

    // 同步停止会话（确保回调完全停止后再清理资源）
    if (sSession && sCaptureQueue) {
        dispatch_sync(sCaptureQueue, ^{
            if ([sSession isRunning]) {
                [sSession stopRunning];
            }
        });
    }

    // 清理 Metal 资源
    sPipeline = nil;
    sVertexBuffer = nil;
    if (sTextureCache) {
        CVMetalTextureCacheFlush(sTextureCache, 0);
        CFRelease(sTextureCache);
        sTextureCache = NULL;
    }
    sCommandQueue = nil;
    sDevice = nil;

    // 清理 AVFoundation 资源
    sSession = nil;
    sOutput = nil;
    sDelegate = nil;

    // 清理 Metal 层（从父图层移除）
    if (sMetalLayer) {
        [sMetalLayer removeFromSuperlayer];
        sMetalLayer = nil;
    }

    // 清理采集队列
    sCaptureQueue = nil;

    // 注意：tsfn 引用由 capture_addon.cc 的 destroy() 管理，此处不清理
}

/// 枚举视频设备，返回 JSON 字符串
const char *list_video_devices() {
    @autoreleasepool {
        // 使用 DiscoverySession 枚举外部设备（采集卡等 UVC 设备）
        AVCaptureDeviceDiscoverySession *session =
            [AVCaptureDeviceDiscoverySession
                discoverySessionWithDeviceTypes:@[AVCaptureDeviceTypeExternal]
                                      mediaType:AVMediaTypeVideo
                                      position:AVCaptureDevicePositionUnspecified];

        NSMutableArray *devices = [NSMutableArray array];
        for (AVCaptureDevice *device in devices) {
            [devices addObject:@{
                @"deviceId": device.uniqueID ?: @"",
                @"label": device.localizedName ?: @""
            }];
        }

        // 序列化为 JSON
        NSError *jsonError = nil;
        NSData *jsonData = [NSJSONSerialization
            dataWithJSONObject:devices
                       options:0
                         error:&jsonError];

        NSString *jsonString = nil;
        if (jsonData) {
            jsonString = [[NSString alloc] initWithData:jsonData
                                              encoding:NSUTF8StringEncoding];
        }

        // 使用静态缓冲区存储结果（每次调用释放上一次的结果）
        static char *sLastResult = nullptr;
        if (sLastResult) {
            free(sLastResult);
            sLastResult = nullptr;
        }

        if (jsonString) {
            const char *utf8 = [jsonString UTF8String];
            if (utf8) {
                sLastResult = strdup(utf8);
            }
        }

        return sLastResult ? sLastResult : "[]";
    }
}

}  // extern "C"
