import type { CapacitorConfig } from '@capacitor/cli';

/**
 * إعدادات Capacitor (اختيارية)
 * ------------------------------------------------------------------
 * المشروع يبني ملف APK جاهزاً بدون Android Studio عبر:
 *     node tools/android/build-apk.mjs
 *
 * لكن إن رغبت بالبناء عبر Android Studio/Gradle، استخدم هذه الإعدادات:
 *     cd client
 *     npm run build:android
 *     npx cap add android
 *     npx cap sync android
 *
 * ملاحظة: بناء الأندرويد يحتاج Android SDK (غير متوفر في هذه البيئة)،
 * ولهذا أضفنا مسار البناء المباشر أعلاه ليعمل في أي مكان.
 */
const config: CapacitorConfig = {
  appId: 'com.trix.game',
  appName: 'طرنيب أونلاين',
  webDir: 'dist-android',
  android: {
    // ملاحظة: لو أردت تغيير الأصل (scheme) استخدم خيار الخادم أدناه
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },
  // أصل https محلي حتى تعمل الذاكرة المحلية والاتصال بالشبكة بشكل موثوق
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#061410',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
