import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'hybrid',
  adapter: cloudflare(),
  integrations: [
    react(),
    tailwind(),
  ],
  vite: {
    define: {
      'import.meta.env.PUBLIC_API_BASE': JSON.stringify(
        'https://wow-market-api.benjamin-f-mcdaniel.workers.dev/api'
      ),
    },
  },
});
