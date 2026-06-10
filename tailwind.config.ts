import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0a0a0b',
          900: '#101013',
          800: '#16161b',
          700: '#1d1d24',
          600: '#26262f',
          500: '#3a3a46',
          400: '#5a5a6a',
          300: '#8b8b9a',
          200: '#c6c6d0',
          100: '#e8e8ee',
        },
        accent: {
          DEFAULT: '#d1d1d8',
          bright: '#ffffff',
        },
        amber: {
          flag: '#f0b429',
          flagDim: '#3b2d10',
        },
        danger: {
          flag: '#e5484d',
          flagDim: '#3a1316',
        },
        ok: {
          flag: '#46a758',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SF Mono', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 24px -12px rgba(0,0,0,0.6)',
      },
    },
  },
  plugins: [],
};

export default config;
