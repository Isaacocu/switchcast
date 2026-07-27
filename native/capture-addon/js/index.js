'use strict';

/**
 * capture-addon JS 包装层
 *
 * 职责：
 *   - 平台守卫：仅 macOS 加载原生模块，其他平台返回 null
 *   - 加载失败回退：原生模块编译/加载失败时优雅降级为 null
 *   - JSON 解析包装：listVideoDevices 原生层返回 JSON 字符串，此处解析为数组
 */

const path = require('path');

let addon = null;

// 仅 macOS 加载原生模块
if (process.platform === 'darwin') {
  try {
    addon = require('bindings')('capture_addon.node');
  } catch (err) {
    console.warn('[capture-addon] 原生模块加载失败，回退 WebView:', err.message);
    addon = null;
  }
}

// 包装 listVideoDevices：原生层返回 JSON 字符串，解析为 JS 数组
if (addon) {
  const rawListVideoDevices = addon.listVideoDevices;
  addon.listVideoDevices = function () {
    const json = rawListVideoDevices.call(addon);
    try {
      return json ? JSON.parse(json) : [];
    } catch (e) {
      console.warn('[capture-addon] 设备列表 JSON 解析失败:', e.message);
      return [];
    }
  };
}

module.exports = addon;  // 非 macOS 或加载失败时为 null
