// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://3dmodelfileconverter.com',
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    worker: {
      format: 'es',
    },
  },
});
