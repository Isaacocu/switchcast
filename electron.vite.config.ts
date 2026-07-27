import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/main/index.ts')
      },
      rollupOptions: {
        // 原生采集模块为本地路径 require，运行时相对 out/main/ 解析到项目根，
        // 构建时不可打包，需显式外置避免 rollup 解析失败
        external: [
          'capture-addon',
          '../../native/capture-addon/js/index.js'
        ]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/preload/index.ts')
      }
    }
  },
  renderer: {
    plugins: [vue()],
    root: '.',
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'index.html')
      }
    },
    resolve: {
      alias: {
        '@': resolve('src')
      }
    }
  }
})
