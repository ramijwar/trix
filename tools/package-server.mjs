/**
 * تجهيز حزمة الخادم للرفع على cPanel
 *   node tools/package-server.mjs
 * المخرجات: release/cpanel-server.zip
 *  - لا يتضمن قاعدة بيانات التطوير ولا كلمة السر الخاصة بك
 *  - يُنشئ config.php جاهزاً بإعدادات إنتاج آمنة (debug=false، سرّ عشوائي)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server');
const RELEASE = path.join(ROOT, 'release');
const STAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'trix-server-'));
const OUT_DIR = path.join(STAGE, 'trix');
const ZIP = path.join(RELEASE, 'cpanel-server.zip');

function log(...a) {
  console.log('[package]', ...a);
}

function copyTree(src, dest, skip = () => false) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const rel = path.join(path.relative(SERVER, path.join(src, entry.name)));
    if (skip(rel, entry)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(s, d, skip);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

const skip = (rel) => {
  const norm = rel.split(path.sep).join('/');
  return (
    norm === 'config.php' ||
    norm.startsWith('data/') && !norm.endsWith('.htaccess') ||
    norm.endsWith('.sqlite') ||
    norm.endsWith('.sqlite-shm') ||
    norm.endsWith('.sqlite-wal') ||
    norm.endsWith('.log') ||
    norm.endsWith('.DS_Store') ||
    norm.endsWith('.apk') ||
    norm.startsWith('backups/')
  );
};

log('نسخ ملفات الخادم…');
copyTree(SERVER, OUT_DIR, skip);

// ---- واجهة الويب المبنية: تُنسخ بجانب index.php ليصبح الموقع كاملاً (لعبة + API) ----
const DIST = path.join(ROOT, 'client', 'dist');
if (fs.existsSync(path.join(DIST, 'index.html'))) {
  log('نسخ واجهة الويب المبنية…');
  copyTree(DIST, OUT_DIR, (rel) => rel.endsWith('.map'));
} else {
  log('⚠ لم يتم العثور على client/dist — نفّذ: cd client && npm run build');
}

// بيانات المجلد + ملف حماية
fs.mkdirSync(path.join(OUT_DIR, 'data'), { recursive: true });
fs.writeFileSync(
  path.join(OUT_DIR, 'data', '.htaccess'),
  `# منع الوصول المباشر لقاعدة البيانات من المتصفح
<IfModule mod_authz_core.c>
  Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
  Order allow,deny
  Deny from all
</IfModule>
`,
);

// config.php إنتاجي
const secret = Array.from({ length: 48 }, () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 62)]).join('');
const config = `<?php
/**
 * إعدادات خادم طرنيب أونلاين — نسخة الإنتاج
 * عدّل القيم التالية حسب استضافتك، ثم احتفظ بهذا الملف بعيداً عن المتصفح.
 */
return [
    // مسار قاعدة بيانات SQLite (يجب أن يكون المجلد قابلاً للكتابة — 755 أو 775)
    'data_dir' => __DIR__ . '/data',

    // مفتاح سري فريد لهذا الموقع — لا تشاركه مع أحد
    'secret' => '${secret}',

    'app_name' => 'طرنيب أونلاين',

    // اتركه false في الإنتاج (يكشف تفاصيل الأخطاء إن كان true)
    'debug' => false,

    // زمن تفكير البوت بالثواني (1.2 مناسب للعب الحقيقي)
    'bot_delay' => 1.2,

    // النطاقات المسموحة — أبقها ['*'] ليعمل تطبيق الأندرويد بسهولة
    'allow_origins' => ['*'],

    // مدة الاستعلام الطويل بالثواني (قلّلها إلى 15 إذا كان مستضيفك يقصر مدة التنفيذ)
    'poll_wait' => 25,

    // الحدود العامة
    'max_rooms' => 300,
    'guest_enabled' => true,
    'maintenance' => false,

    // النقاط الافتراضية
    'default_target' => 31,

    // مكافآت العملات
    'daily_bonus' => 200,
    'coins_win' => 120,
    'coins_lose' => 40,
];
`;
fs.writeFileSync(path.join(OUT_DIR, 'config.php'), config);

// ملف تعليمات مختصر داخل الحزمة
fs.writeFileSync(
  path.join(OUT_DIR, 'اقرأني.txt'),
  `طرنيب أونلاين — ملفات الخادم (PHP + SQLite)
=========================================

خطوات التركيب على cPanel:
1) ارفع محتويات هذا المجلد إلى مجلد داخل public_html (مثال: public_html/trix).
2) افتح بالمتصفح:  https://موقعك/trix/install.php   لمتابعة الفحص.
3) تأكد أن مجلد data/ قابل للكتابة (755 أو 775).
4) افتح اللعبة في المتصفح:  https://موقعك/trix/
   وفحص الخادم:            https://موقعك/trix/index.php?r=health
5) في تطبيق الأندرويد: افتح الإعدادات واكتب عنوان المجلد (مثال https://موقعك/trix).

ملاحظات:
- لا تحتاج MySQL: قاعدة البيانات SQLite تُنشأ تلقائياً في مجلد data/.
- ملف config.php يحتوي مفتاحاً سرياً عشوائياً خاصاً بموقعك — لا تشاركه.
- لعطل أي مشكلة: افحص الأخطاء في data/errors.log (يُنشأ عند أول خطأ).
- كل الطلبات تمر عبر index.php?r=...  مع CORS مفعّل لتطبيق الأندرويد.

جميع الحقوق: المشروع كامل المصدر داخل هذا الأرشيف (PHP) + كود الواجهة في مشروع العميل.
`);
log('إنشاء الأرشيف…');
fs.mkdirSync(RELEASE, { recursive: true });
fs.rmSync(ZIP, { force: true });
execFileSync('sh', ['-c', `cd "${STAGE}" && zip -q -r -X "${ZIP}" trix`]);

const size = (fs.statSync(ZIP).size / 1024).toFixed(0);
log(`✅ تم إنشاء الحزمة: ${ZIP} (${size} كيلوبايت)`);
const listing = execFileSync('unzip', ['-l', ZIP], { encoding: 'utf8' }).split('\n');
console.log(listing.slice(0, 22).join('\n'));
