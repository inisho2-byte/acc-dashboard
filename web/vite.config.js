import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const noCrossOriginPlugin = () => ({
  name: 'no-crossorigin',
  transformIndexHtml(html) {
    return html.replace(/ crossorigin/g, '');
  },
});

export default defineConfig({
  plugins: [react(), noCrossOriginPlugin()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8643' } },
});
