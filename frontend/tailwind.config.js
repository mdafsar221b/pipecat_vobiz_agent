/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: '#f8fafc',
          surface: '#ffffff',
          surfaceHover: '#f1f5f9',
          border: '#e2e8f0',
          borderFocus: '#2563eb',
          text: '#0f172a',
          textMuted: '#64748b',
          primary: '#2563eb',
          primaryHover: '#1d4ed8',
          success: '#059669',
          warning: '#d97706',
          danger: '#dc2626',
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      }
    },
  },
  plugins: [],
}
