import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import manifest from './manifest.json';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const isFirefox = mode === 'firefox';
  const appVersion = process.env.npm_package_version ?? manifest.version;
  const extensionManifest = {
    ...manifest,
    version: appVersion,
    name: isFirefox ? 'silence-translator (Firefox)' : manifest.name,
  };

  return {
    plugins: [react(), crx({ manifest: extensionManifest as any })],
    build: {
      outDir: isFirefox ? 'dist-firefox' : 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          popup: resolve(__dirname, 'popup.html'),
          options: resolve(__dirname, 'options.html'),
        },
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
  };
});
