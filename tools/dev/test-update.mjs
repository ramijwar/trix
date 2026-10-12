/**
 * اختبار خاصية «تحديث التطبيق من داخله»
 *   cd tools/dev && node test-update.mjs
 *
 * يتحقق من:
 *   - حفظ بيانات النسخة من لوحة المدير (الرقم/الاسم/الملاحظات/الإجباري/الحد الأدنى).
 *   - رفع ملف APK على أجزاء (start → chunk* → finish) والتحقق من البصمة والحجم.
 *   - فحص التحديث app/version: نسخة أقدم ⇒ تحديث، أحدث ⇒ لا تحديث، والرسالة الإجبارية.
 *   - تنزيل الملف app/apk يعيد نفس البايتات (وضع التطوير: base64).
 *   - رفض ملف ليس APK، ورفض الإكمال قبل وصول كل الأجزاء، ورفض غير المدير.
 *   - تقرير «من لم يُحدِّث» في لوحة المدير.
 */
const BASE = process.env.TRIX_API || 'http://127.0.0.1:8095/index.php?r=';
const NO_PRELOAD = process.env.TRIX_NOPRELOAD ? '&__nopreload=1' : '';

const withQuery = (route, body, method) => {
  if (method !== 'GET' || !body || Object.keys(body).length === 0) return route;
  const qs = new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString();
  return route + '&' + qs;
};

let pass = 0;
let fail = 0;
const check = (label, cond, detail = '') => {
  if (cond) {
    pass++;
    console.log('  ✅', label);
  } else {
    fail++;
    console.log('  ❌', label, detail);
  }
};

async function api(route, body = {}, token = '', method = 'POST', timeout = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(BASE + withQuery(route, body, method) + NO_PRELOAD, {
      method,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** الحساب المدير: اسم المستخدم 'admin' مُدرَج في config.php كمدير */
const loginAs = async (username, name) => {
  const res = await api('auth/register', { username, password: '123456', name, avatar: '🛡️' });
  if (res.token) return res;
  return api('auth/login', { username, password: '123456' });
};

/* ============================ التجهيز ============================ */
const adminUser = await loginAs('admin', 'مدير النسخ');
check('حساب admin مدير فعلاً', Boolean(adminUser.token), JSON.stringify(adminUser).slice(0, 120));
const playerName = 'up' + Math.random().toString(36).slice(2, 9);
const player = await api('auth/register', {
  username: playerName,
  password: '123456',
  name: 'لاعب قديم',
  avatar: '🙂',
});
check('إنشاء حساب اللاعب ينجح', Boolean(player.token), JSON.stringify(player).slice(0, 120));

const A = adminUser.token;
const P = player.token;

/* ============================ 1) بيانات النسخة ============================ */
const save1 = await api('admin/update/settings', {
  versionCode: 2,
  versionName: '1.0.1',
  notes: 'إصلاح الاتصال + سرعة أعلى',
  forced: false,
  minCode: 0,
}, A);
check('حفظ بيانات النسخة ينجح', save1.ok === true && save1.settings?.versionCode === 2, JSON.stringify(save1).slice(0, 160));
check('اسم النسخة والملاحظات تُحفظ', save1.settings?.versionName === '1.0.1' && save1.settings?.notes.includes('سرعة'), JSON.stringify(save1.settings));

const noAdmin = await api('admin/update/settings', { versionCode: 9 }, P);
check('غير المدير لا يستطيع تعديل النسخة', noAdmin.ok === false, JSON.stringify(noAdmin).slice(0, 120));

/* ============================ 2) رفع APK على أجزاء ============================ */
const CHUNK = 512 * 1024;
// ملف APK وهمي صالح البداية (PK\x03\x04) بحجم ~1.1 ميجابايت ⇒ 3 أجزاء
const size = 1100000;
const fake = Buffer.alloc(size);
Buffer.from('PK\x03\x04', 'binary').copy(fake, 0);
for (let i = 4; i < size; i++) fake[i] = (i * 31 + 7) % 256;
const total = Math.ceil(size / CHUNK);
const crypto = await import('node:crypto');
const sha = crypto.createHash('sha256').update(fake).digest('hex');

const start = await api('admin/update/upload/start', {
  size,
  total,
  versionCode: 2,
  versionName: '1.0.1',
  sha256: sha,
}, A, 'POST', 60000);
check('بدء رفع الأجزاء ينجح', start.ok === true && typeof start.upload?.id === 'string', JSON.stringify(start).slice(0, 160));

const uploadId = start.upload.id;
let lastChunk = null;
for (let i = 0; i < total; i++) {
  const slice = fake.subarray(i * CHUNK, Math.min(size, (i + 1) * CHUNK));
  lastChunk = await api('admin/update/upload/chunk', { upload: uploadId, index: i, data: slice.toString('base64') }, A, 'POST', 60000);
}
check('رفع كل الأجزاء ينجح', lastChunk?.ok === true && lastChunk.upload?.received === total, JSON.stringify(lastChunk).slice(0, 160));
check('نسبة التقدّم تصل 100%', lastChunk?.percent === 100, String(lastChunk?.percent));

const finish = await api('admin/update/upload/finish', { upload: uploadId }, A, 'POST', 120000);
check('إكمال الرفع يثبّت النسخة', finish.ok === true && finish.size === size, JSON.stringify(finish).slice(0, 160));
check('بصمة الملف المرفوع مطابقة', finish.ok === true && finish.sha256 === sha, `${finish.sha256} ≠ ${sha}`);
check('النسخة المنشورة صارت 2', finish.settings?.versionCode === 2, JSON.stringify(finish.settings).slice(0, 160));

/* ============================ 3) فحص التحديث ============================ */
const old16 = await api('app/version', { version_code: 1, platform: 'android' }, '', 'GET');
check('جهاز بنسخة أقدم يرى تحديثاً', old16.ok === true && old16.update === true, JSON.stringify(old16).slice(0, 200));
check('التحديث غير إجباري افتراضياً', old16.forced === false, String(old16.forced));
check('الرسالة تحمل رقم واسم النسخة الجديدة', old16.versionCode === 2 && old16.versionName === '1.0.1', JSON.stringify(old16).slice(0, 160));
check('رابط التنزيل موجود في الرسالة', typeof old16.url === 'string' && old16.url.includes('app/apk'), String(old16.url));
check('حجم الملف يُرسل للعرض', old16.size === size, `${old16.size} ≠ ${size}`);

const newest = await api('app/version', { version_code: 2, platform: 'android' }, '', 'GET');
check('جهاز بأحدث نسخة لا يرى تحديثاً', newest.ok === true && newest.update === false, JSON.stringify(newest).slice(0, 160));

const web = await api('app/version', { version_code: 0, platform: 'web' }, '', 'GET');
check('نسخة الويب (بلا رقم) ترى التحديث', web.update === true, JSON.stringify(web).slice(0, 120));

/* ============================ 4) الإجبارية ============================ */
const forced = await api('admin/update/settings', { forced: true }, A);
check('تفعيل التحديث الإجباري', forced.ok === true && forced.settings?.forced === true);
const oldForced = await api('app/version', { version_code: 1 }, '', 'GET');
check('الجهاز القديم يرى التحديث إجبارياً', oldForced.update === true && oldForced.forced === true, JSON.stringify(oldForced).slice(0, 160));

const minSet = await api('admin/update/settings', { forced: false, minCode: 2 }, A);
check('ضبط «أقل نسخة مدعومة»', minSet.ok === true && minSet.settings?.minCode === 2, JSON.stringify(minSet.settings).slice(0, 160));
const minForced = await api('app/version', { version_code: 1 }, '', 'GET');
check('نسخة أقدم من الحد الأدنى ⇒ إجباري', minForced.forced === true && minForced.forced !== forced.forced, JSON.stringify(minForced).slice(0, 160));
const minOk = await api('app/version', { version_code: 2 }, '', 'GET');
check('نسخة عند الحد الأدنى ⇒ لا تحديث أصلاً', minOk.update === false, JSON.stringify(minOk).slice(0, 120));

/* ============================ 5) التنزيل ============================ */
const dl = await api('app/apk', { b64: 1 }, '', 'GET', 120000);
check('تنزيل النسخة ينجح', dl.ok === true && typeof dl.b64 === 'string' && dl.size === size, JSON.stringify({ size: dl.size, len: dl.b64?.length }).slice(0, 160));
const downloaded = Buffer.from(dl.b64 || '', 'base64');
check('الملف المُنزَّل مطابق للمرفوع بايتاً ببايت', downloaded.length === size && downloaded.equals(fake), `len=${downloaded.length}`);
check('بداية الملف حزمة أندرويد (PK)', downloaded.subarray(0, 2).toString() === 'PK', downloaded.subarray(0, 4).toString('hex'));

/* ============================ 6) تقرير «من لم يُحدِّث» ============================ */
// لاعب لا يزال على نسخة أقدم وفتح التطبيق للتوّ
const asked = await api('app/version', { version_code: 1 }, P, 'GET');
check('تسجيل ظهور الإشعار للاعب', asked.ok === true && asked.update === true);
// لاعب آخر على أحدث نسخة (يجب ألا يظهر في تقرير «لم يُحدِّث»)
const freshName = 'nw' + Math.random().toString(36).slice(2, 9);
const fresh = await api('auth/register', { username: freshName, password: '123456', name: 'لاعب محدَّث', avatar: '🙂' });
check('حساب اللاعب المحدَّث جاهز', Boolean(fresh.token), JSON.stringify(fresh).slice(0, 120));
const freshCheck = await api('app/version', { version_code: 2 }, fresh.token, 'GET');
check('اللاعب المحدَّث لا يرى تحديثاً', freshCheck.ok === true && freshCheck.update === false, JSON.stringify(freshCheck).slice(0, 120));
const state = await api('admin/update', { days: 30 }, A, 'GET');
check('لوحة المدير تعرض بيانات النسخة', state.ok === true && state.settings?.versionCode === 2, JSON.stringify(state.settings).slice(0, 160));
check('تقرير الإحصاءات يعمل', state.report && typeof state.report.pending === 'number', JSON.stringify(state.report).slice(0, 160));
const meRow = (state.report?.users || []).find((u) => u.username === playerName);
check('اللاعب القديم ظاهر في تقرير «لم يُحدِّث»', Boolean(meRow), JSON.stringify(state.report?.users?.slice(0, 3)));
check('يظهر أن الإشعار ظهر له', meRow?.asked === true, JSON.stringify(meRow));
const adminRow = (state.report?.users || []).find((u) => u.username === adminUser.username);
check('من لم يفتح التطبيق أصلاً يُعلَّم بذلك', !adminRow || adminRow.asked === false, JSON.stringify(adminRow));
check('اللاعب المحدَّث لا يظهر في تقرير «لم يُحدِّث»', !(state.report?.users || []).some((u) => u.username === fresh.username), JSON.stringify(state.report?.users?.map((u) => u.username)));
check('عدد «حدَّثوا» يزيد عن صفر', (state.report?.updated ?? 0) >= 1, JSON.stringify(state.report));
check('نسخة اللاعب في التقرير = القديمة', meRow?.clientCode === 1, JSON.stringify(meRow));

/* ============================ 7) حالات الرفض ============================ */
const badStart = await api('admin/update/upload/start', { size: 100000, total: 1, versionCode: 0 }, A);
check('رفض الرفع بلا رقم نسخة', badStart.ok === false, JSON.stringify(badStart).slice(0, 140));

const start2 = await api('admin/update/upload/start', { size: 2048, total: 4, versionCode: 3 }, A);
const inc = await api('admin/update/upload/finish', { upload: start2.upload.id }, A);
check('رفض الإكمال قبل وصول كل الأجزاء', inc.ok === false && inc.code === 'incomplete', JSON.stringify(inc).slice(0, 160));

const notApk = Buffer.alloc(4096, 7);
const apkStart = await api('admin/update/upload/start', { size: notApk.length, total: 1, versionCode: 3 }, A);
await api('admin/update/upload/chunk', { upload: apkStart.upload.id, index: 0, data: notApk.toString('base64') }, A, 'POST', 60000);
const apkFinish = await api('admin/update/upload/finish', { upload: apkStart.upload.id }, A);
check('رفض ملف ليس APK', apkFinish.ok === false && apkFinish.code === 'not_apk', JSON.stringify(apkFinish).slice(0, 160));

const wrongHash = await api('admin/update/upload/start', {
  size: notApk.length,
  total: 1,
  versionCode: 3,
  sha256: 'f'.repeat(64),
}, A);
await api('admin/update/upload/chunk', { upload: wrongHash.upload.id, index: 0, data: fake.subarray(0, 4096).toString('base64') }, A, 'POST', 60000);
const hashFail = await api('admin/update/upload/finish', { upload: wrongHash.upload.id }, A);
check('رفض بصمة SHA-256 غير مطابقة', hashFail.ok === false && hashFail.code === 'hash_mismatch', JSON.stringify(hashFail).slice(0, 160));

const cancelTry = await api('admin/update/upload/cancel', { upload: 'nope' }, A);
check('إلغاء جلسة غير موجودة لا يكسر شيئاً', cancelTry.ok === true, JSON.stringify(cancelTry).slice(0, 120));

/* ============================ 8) الحذف والإيقاف ============================ */
const del = await api('admin/update/delete', {}, A);
check('حذف ملف النسخة ينجح', del.ok === true, JSON.stringify(del).slice(0, 140));
const afterDel = await api('app/version', { version_code: 1 }, '', 'GET');
check('بعد حذف الملف لا يوجد تحديث', afterDel.update === false, JSON.stringify(afterDel).slice(0, 160));
const dlGone = await api('app/apk', {}, '', 'GET');
check('تنزيل ملف محذوف يعطي 404 واضحاً', dlGone.ok === false && dlGone.code === 'no_apk', JSON.stringify(dlGone).slice(0, 160));

const disable = await api('admin/update/disable', {}, A);
check('إيقاف إشعار التحديث يصفّر رقم النسخة', disable.ok === true && disable.settings?.versionCode === 0, JSON.stringify(disable.settings).slice(0, 160));
const backToNormal = await api('app/version', { version_code: 1 }, '', 'GET');
check('لا إشعار تحديث بعد الإيقاف', backToNormal.update === false, JSON.stringify(backToNormal).slice(0, 120));

/* ============================ 9) رابط خارجي بديل ============================ */
const ext = await api('admin/update/settings', { versionCode: 5, versionName: '2.0.0', url: 'https://example.com/trix.apk' }, A);
check('حفظ رابط تنزيل خارجي', ext.ok === true && ext.settings?.url === 'https://example.com/trix.apk', JSON.stringify(ext.settings).slice(0, 160));
const extCheck = await api('app/version', { version_code: 2 }, '', 'GET');
check('التحديث يعمل بالرابط الخارجي بلا ملف على الخادم', extCheck.update === true && extCheck.url === 'https://example.com/trix.apk', JSON.stringify(extCheck).slice(0, 200));
await api('admin/update/disable', {}, A);

console.log(`\n✅ ناجح: ${pass}   ❌ فاشل: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
