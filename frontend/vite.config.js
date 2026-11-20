import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Detect backend port dynamically from root .env or environment
function getBackendPort() {
  const rootDir = path.resolve(__dirname, '..')
  const envPath = path.join(rootDir, '.env')
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8')
    const match = envContent.match(/^PORT\s*=\s*(\d+)/m) || envContent.match(/^HTTP_PORT\s*=\s*(\d+)/m)
    if (match) return match[1]
  }
  return process.env.PORT || process.env.HTTP_PORT || '8000'
}

const backendPort = getBackendPort()
const backendTarget = `http://127.0.0.1:${backendPort}`

// Configure Vite with dev proxy to FastAPI server and shadcn path alias
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/calls': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/health': {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
})
