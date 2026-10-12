/**
 * نشر نسخة جديدة من التطبيق من سطر الأوامر (نفس ما يفعله تاب «التحديث» في اللوحة)
 * ----------------------------------------------------------------------------
 *   cd tools/dev
 *   node publish-apk.mjs ../../release/trix-android.apk 3 1.0.2 "ما الجديد…"
 *
 * متغيرات اختيارية:
 *   TRIX_API        عنوان الخادم (افتراضياً http://127.0.0.1:8095/index.php?r=)
 *   TRIX_ADMIN_USER اسم حساب المدير (افتراضياً admin)
 *   TRIX_ADMIN_PASS كلمة مروره (افتراضياً 123456)
 *   TRIX_FORCED     =1 لجعل التحديث إجبارياً
 *   TRIX_MIN_CODE   أقل نسخة مدعومة (إجباري قبلها)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = process.env.TRIX_API || 'http://127.0.0.1:8095/index.php?r=';
const CHUNK = 512 * 1024;

const [apkPath, codeArg, nameArg, notesArg] = process.argv.slice(2);
if (!apkPath || !codeArg) {
  console.error('الاستخدام: node publish-apk.mjs <ملف.apk> <رقم النسخة> [اسم النسخة] [ملاحظات]');
  process.exit(1);
}
const file = path.resolve(apkPath);
if (!fs.existsSync(file)) {
  console.error('❌ الملف غير موجود:', file);
  process.exit(1);
}
const buf = fs.readFileSync(file);
if (buf.subarray(0, 2).toString() !== 'PK') {
  console.error('❌ الملف ليس حزمة APK صالحة');
  process.exit(1);
}
const versionCode = Number(codeArg) || 0;
const versionName = nameArg || `1.0.${Math.max(0, versionCode - 1)}`;
const notes = notesArg || '';
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

const api = async (route, body = {}, token = '', timeout = 60000) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(BASE + route, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(body),
    });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
};

const user = process.env.TRIX_ADMIN_USER || 'admin';
const pass = process.env.TRIX_ADMIN_PASS || '123456';
let auth = await api('auth/login', { username: user, password: pass });
if (!auth.token) {
  auth = await api('auth/register', { username: user, password: pass, name: 'مدير', avatar: '🛡️' });
}
if (!auth.token) {
  console.error('❌ تعذّر الدخول كمدير:', JSON.stringify(auth).slice(0, 200));
  process.exit(1);
}
console.log(`▶️ رفع ${path.basename(file)} (${(buf.length / 1024).toFixed(0)} كيلوبايت) كنسخة ${versionName} (${versionCode})…`);

const total = Math.max(1, Math.ceil(buf.length / CHUNK));
const started = await api('admin/update/upload/start', {
  size: buf.length,
  total,
  versionCode,
  versionName,
  sha256,
  notes,
}, auth.token);
if (!started.ok) {
  console.error('❌ فشل بدء الرفع:', JSON.stringify(started).slice(0, 300));
  process.exit(1);
}
const upload = started.upload.id;
for (let i = 0; i < total; i++) {
  const slice = buf.subarray(i * CHUNK, Math.min(buf.length, (i + 1) * CHUNK));
  const res = await api('admin/update/upload/chunk', { upload, index: i, data: slice.toString('base64') }, auth.token);
  if (!res.ok) {
    console.error('❌ فشل رفع الجزء', i, JSON.stringify(res).slice(0, 200));
    process.exit(1);
  }
  process.stdout.write(`\r   ${res.percent}% (${i + 1}/${total})   `);
}
console.log('');
const done = await api('admin/update/upload/finish', { upload }, auth.token, 180000);
if (!done.ok) {
  console.error('❌ فشل تثبيت النسخة:', JSON.stringify(done).slice(0, 300));
  process.exit(1);
}
const settings = await api('admin/update/settings', {
  versionCode,
  versionName,
  notes,
  forced: process.env.TRIX_FORCED === '1',
  minCode: Number(process.env.TRIX_MIN_CODE || 0),
}, auth.token);
if (!settings.ok) {
  console.error('❌ فشل حفظ بيانات النسخة:', JSON.stringify(settings).slice(0, 300));
  process.exit(1);
}
console.log(`✅ نُشرت النسخة ${versionName} (${versionCode}) — الحجم ${(done.size / 1024).toFixed(0)} كيلوبايت`);
console.log(`   SHA-256: ${done.sha256}`);
console.log(`   إجباري: ${process.env.TRIX_FORCED === '1' ? 'نعم' : 'لا'} • أقل نسخة مدعومة: ${process.env.TRIX_MIN_CODE || 0}`);
console.log('   كل لاعب يفتح التطبيق الآن يرى شاشة التحديث.');
