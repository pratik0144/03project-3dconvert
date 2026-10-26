// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://3dmodelfileconverter.com',
  integrations: [react()],
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
