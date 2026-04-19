import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      // NOT: API anahtarlarını buraya ekleme — build çıktısına gömülür ve
      // tarayıcı kaynak kodunda görünür hale gelir.
      // Bunun yerine import.meta.env.VITE_* kullan.
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
