/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0d0d0f',
          2: '#16181c',
          3: '#1e2028',
        },
        border: '#2e3040',
        wow: {
          gold: '#f0c060',
          blue: '#4a90d9',
          green: '#4caf7d',
          red: '#cf4e4e',
          purple: '#9b59b6',
          legendary: '#e67e22',
        },
        quality: {
          poor: '#9d9d9d',
          common: '#ffffff',
          uncommon: '#4caf7d',
          rare: '#4a90d9',
          epic: '#b47bff',
          legendary: '#e67e22',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
