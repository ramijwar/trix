import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * إعدادات Vite
 * - الخادم يستمع على 0.0.0.0 حتى يعمل المعاينة داخل البيئة السحابية وعلى الجوال في نفس الشبكة
 * - وكيل /api إلى خادم PHP المحلي أثناء التطوير (tools/dev/php-server.mjs)
 */
export default defineConfig(({ mode }) => {
  const isAndroid = mode === 'android';
  return {
    plugins: [react(), tailwindcss()],
    // مسارات نسبية حتى تعمل الواجهة من أي مجلد على الاستضافة (أو داخل التطبيق)
    base: './',
    build: {
      outDir: isAndroid ? 'dist-android' : 'dist',
      emptyOutDir: true,
      target: 'es2020',
      chunkSizeWarningLimit: 1200,
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: false,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: process.env.TRIX_API_TARGET || 'http://127.0.0.1:8095',
          changeOrigin: true,
          secure: false,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      allowedHosts: true,
    },
  };
});
