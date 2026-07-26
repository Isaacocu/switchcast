/**
 * electron-builder afterPack 钩子 — macOS ad-hoc 签名
 *
 * 背景：无 Apple Developer 证书时 electron-builder 跳过签名，
 * 完全无签名的应用在新版 macOS 上会被 Gatekeeper 判定为恶意软件直接移入废纸篓。
 * ad-hoc 签名（-s -）让应用降级为"未验证开发者"，用户可通过
 * 系统设置 → 隐私与安全性 → "仍要打开" 正常放行。
 */
const { execSync } = require('child_process')
const path = require('path')

exports.default = async function adhocSign(context) {
  // 仅处理 macOS 产物
  if (context.electronPlatformName !== 'darwin') return

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)

  console.log(`  • ad-hoc signing  app=${appPath}`)
  // --force 覆盖已有签名，--deep 递归签名内嵌 Helper/框架
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' })
  execSync(`codesign --verify --deep "${appPath}"`, { stdio: 'inherit' })
  console.log('  • ad-hoc signing done')
}
