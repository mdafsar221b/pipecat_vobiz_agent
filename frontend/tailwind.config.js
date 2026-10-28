/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        nugget: {
          primary: '#008792',
          primaryDark: '#007680',
          primaryDarkest: '#0f2c32',
          primaryLight: '#f4f9f9',
          primaryLighter: '#66ccd1',
          primaryUltraLight: '#e0efef',
          secondary: '#0a0a0a',
          surface: '#171717',
          surfaceRaised: '#1d1d1f',
          tertiary: '#525252',
          border: '#e5e5e5',
          borderDark: '#262626',
          canvas: '#fafafa',
          canvasDark: '#0c0a09',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'nugget-sm': '0 1px 2px rgba(0, 0, 0, 0.05)',
        'nugget': '0 4px 12px rgba(0, 135, 146, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04)',
        'nugget-glow': '0 0 20px rgba(0, 135, 146, 0.25)',
      }
    },
  },
  plugins: [],
}
