/**
 * إعدادات البناء
 * ------------------------------------------------------------------
 * عنوان الخادم المضمَّن في التطبيق (نسخة الأندرويد):
 *
 *   https://t3lam.site/trix
 *
 * - في تطبيق الأندرويد: يتصل التطبيق بهذا العنوان تلقائياً من أول تشغيل،
 *   ولا يظهر للمستخدم أي سؤال عن العنوان.
 * - في نسخة الويب (المرفوعة مع الخادم): يبقى العنوان فارغاً ليتصل الموقع
 *   بنفس النطاق الذي فُتح منه (يعمل على www وعلى المجلدات الفرعية).
 *
 * يمكن تغييره لأي نطاق آخر من هنا مباشرة، أو مؤقتاً من: ⚙️ الإعدادات داخل التطبيق.
 * كما يمكن تمريره وقت البناء بدون تعديل الملف:
 *   VITE_TRIX_SERVER=https://example.com/trix node tools/android/build-apk.mjs
 */
const ANDROID_SERVER = (import.meta.env.VITE_TRIX_SERVER as string | undefined)?.trim() || 'https://t3lam.site/trix';

/** عنوان الخادم المضمَّن (يُستخدم في نسخة الأندرويد فقط) */
export const BUILT_IN_SERVER = import.meta.env.MODE === 'android' ? ANDROID_SERVER : '';

/** اسم اللعبة الظاهر */
export const APP_NAME = 'طرنيب أونلاين';
export const APP_VERSION = '1.0.0';
