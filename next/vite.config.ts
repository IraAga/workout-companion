import { defineConfig } from 'vite';

// The catalog is imported straight from ../contract/data so the new UI and the
// contract cannot drift. Vite needs permission to read outside next/.
export default defineConfig({
  base: './',
  server: { fs: { allow: ['..'] } },
  build: { target: 'es2022', outDir: 'dist' },
});
