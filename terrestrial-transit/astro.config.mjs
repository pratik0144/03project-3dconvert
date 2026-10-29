// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://3dmodelfileconverter.com',
  integrations: [
    react(),
    sitemap({
      filter: (page) =>
        // Exclude duplicate alias pages from sitemap
        !page.includes('/about-us') &&
        !page.includes('/contact-us') &&
        !page.includes('/privacy-policy') &&
        !page.includes('/terms-and-conditions'),
    }),
  ],
  vite: {
    optimizeDeps: {
      include: [
        'three',
        'three/addons/loaders/STLLoader.js',
        'three/addons/loaders/OBJLoader.js',
        'three/addons/loaders/GLTFLoader.js',
        'three/addons/exporters/STLExporter.js',
        'three/addons/exporters/OBJExporter.js',
        'three/addons/exporters/GLTFExporter.js',
        'three/addons/utils/BufferGeometryUtils.js',
        'three/addons/modifiers/SimplifyModifier.js',
        'fflate',
      ],
    },
    plugins: [tailwindcss()],
    worker: {
      format: 'es',
    },
  },
});
