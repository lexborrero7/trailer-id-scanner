import { defineConfig } from 'vite';

export default defineConfig({
  // Legacy Create React App assets are kept in the repository but are not used.
  publicDir: false,
  server: { port: 5173 },
});
