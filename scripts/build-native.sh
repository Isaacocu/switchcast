#!/bin/bash
# macOS 原生采集模块编译脚本
# 仅在 macOS 上执行，Windows 跳过

if [ "$(uname)" != "Darwin" ]; then
  echo "[build-native] 非 macOS，跳过原生模块编译"
  exit 0
fi

# 检查 Xcode 工具链
if ! command -v xcodebuild &> /dev/null; then
  echo "[build-native] 警告: Xcode Command Line Tools 未安装"
  echo "[build-native] 请运行: xcode-select --install"
  exit 1
fi

echo "[build-native] 编译 capture-addon 原生模块..."
cd "$(dirname "$0")/../native/capture-addon"

if [ ! -f binding.gyp ]; then
  echo "[build-native] 错误: binding.gyp 不存在"
  exit 1
fi

# node-gyp 编译
npx node-gyp configure
npx node-gyp build

if [ $? -eq 0 ]; then
  echo "[build-native] 编译成功: build/Release/capture_addon.node"
else
  echo "[build-native] 编译失败"
  exit 1
fi
