import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  root: '.',
  // Production build is served from a GitHub Pages project-site subpath matching
  // the repo name; the dev server (and e2e tests) stay at the root path.
  base: command === 'build' ? '/aero-converter/' : '/',
  build: { outDir: 'dist' },
}));
