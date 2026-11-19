import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const BACKEND_PORT = process.env.BACKEND_PORT || process.env.HTTP_PORT || '8011'
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`

// Configure Vite with dev proxy to FastAPI server and shadcn path alias
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: parseInt(process.env.VITE_PORT || process.env.PORT || '3003', 10),
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
      '/calls': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
      '/health': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
    },
  },
})
