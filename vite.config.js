import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: ['.'],
    },
  },
  // O acad-ts resolve subclasses DXF por constructor.name; sem isto a
  // minificação renomeia as classes e a leitura nativa de DWG quebra
  // ("Zs is not a DXF subclass"). O build web faz o mesmo em vite.config.js.
  esbuild: {
    keepNames: true,
  },
  resolve: {
    alias: {
      'pdfjs-dist': path.resolve(__dirname, 'node_modules/pdfjs-dist'),
      '@cad': path.resolve(__dirname, 'src/cad'),
      '@css': path.resolve(__dirname, 'src/styles'),
    },
  },
});
