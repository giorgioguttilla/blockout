import adapterNode from '@sveltejs/adapter-node';
import adapterStatic from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// BLOCKOUT_WEB=1 builds the hosted, server-less version (Firebase Hosting) into build-web/
const web = process.env.BLOCKOUT_WEB === '1';

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: web ? adapterStatic({ pages: 'build-web', assets: 'build-web', fallback: 'index.html', strict: false }) : adapterNode({ out: 'build' }),
      alias: { $lib: 'src/lib' }
    })
  ],
  server: { port: 5199, strictPort: true }
});
