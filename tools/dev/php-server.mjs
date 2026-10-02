/**
 * خادم تطوير محلي يشغّل كود PHP الأصلي (نفس ملفات cPanel) داخل WebAssembly
 * ----------------------------------------------------------------------
 * الاستخدام:
 *   cd tools/dev && npm install && npm start
 * ثم يشتغل الخادم على http://127.0.0.1:8095
 * - /api/*  و  /index.php?r=*  → تُنفَّذ بواسطة PHP
 * - أي مسار آخر → يخدم ملفات واجهة React المبنية من client/dist (إن وُجدت)
 *
 * ملاحظة: قاعدة بيانات SQLite تُحفظ فعلياً في server/data/trix.sqlite
 *         (تُزامَن بعد كل طلب من نظام ملفات WebAssembly إلى القرص)
 */
import { PhpNode } from 'php-wasm/PhpNode.mjs';
import sqlite from 'php-wasm-sqlite';
import mbstring from 'php-wasm-mbstring';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const SERVER_DIR = path.join(ROOT, 'server');
const CLIENT_DIST = path.join(ROOT, 'client', 'dist');
const DB_ON_DISK = path.join(SERVER_DIR, 'data', 'trix.sqlite');
const WASM_DB = '/data/trix.sqlite';
const PORT = Number(process.env.PORT || 8095);

fs.mkdirSync(path.join(SERVER_DIR, 'data'), { recursive: true });

let php = null;
let phpFilesStamp = 0;

/** إنشاء مجلد داخل نظام ملفات WASM */
async function ensureDir(p) {
  try {
    await php.mkdir(p);
  } catch {
    /* موجود مسبقاً */
  }
}

/** نسخ ملفات PHP من القرص إلى نظام ملفات WASM */
async function copyTree(localDir, remoteDir) {
  await ensureDir(remoteDir);
  for (const entry of fs.readdirSync(localDir, { withFileTypes: true })) {
    const local = path.join(localDir, entry.name);
    const remote = remoteDir + '/' + entry.name;
    if (entry.isDirectory()) {
      await copyTree(local, remote);
    } else if (entry.isFile() && entry.name.endsWith('.php')) {
      await php.writeFile(remote, fs.readFileSync(local));
    }
  }
}

/** بصمة زمنية لكل ملفات PHP في الخادم لكشف التعديلات */
function phpFilesFingerprint() {
  let latest = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'data') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.php')) latest = Math.max(latest, fs.statSync(full).mtimeMs);
    }
  };
  walk(SERVER_DIR);
  return latest;
}

/** تهيئة (أو إعادة تهيئة) بيئة PHP المحلية */
async function bootPhp() {
  console.log('[dev] تهيئة PHP-WASM ...');
  php = new PhpNode({ version: '8.4', sharedLibs: [sqlite, mbstring], autoTransaction: true });
  php.onerror = (e) => console.error('[php stderr]', e && e.detail ? e.detail : e);
  php.onoutput = () => {};
  await php.refresh();

  await ensureDir('/data');
  await ensureDir('/data/locks');
  await ensureDir('/data/backups');
  await ensureDir('/dev');
  await copyTree(path.join(SERVER_DIR, 'src'), '/src');
  await php.writeFile('/index.php', fs.readFileSync(path.join(SERVER_DIR, 'index.php')));
  await php.writeFile('/config.php', fs.readFileSync(path.join(SERVER_DIR, 'config.php')));
  await php.writeFile('/config.sample.php', fs.readFileSync(path.join(SERVER_DIR, 'config.sample.php')));
  await php.writeFile('/dev/bridge.php', fs.readFileSync(path.join(__dirname, 'bridge.php')));

  if (fs.existsSync(DB_ON_DISK)) {
    await php.writeFile(WASM_DB, fs.readFileSync(DB_ON_DISK));
    console.log('[dev] تم تحميل قاعدة البيانات من القرص');
  }
  phpFilesStamp = phpFilesFingerprint();
}

/** تنفيذ طلب HTTP عبر PHP */
async function runPhp(req, rawBody) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const get = {};
  for (const [k, v] of url.searchParams.entries()) get[k] = v;
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : v;

  let post = {};
  const contentType = String(req.headers['content-type'] || '');
  if (rawBody && contentType.includes('application/x-www-form-urlencoded')) {
    post = Object.fromEntries(new URLSearchParams(rawBody).entries());
  }

  // إعادة تشغيل بيئة PHP تلقائياً عند تعديل أي ملف PHP (تجربة تطوير سلسة)
  if (phpFilesFingerprint() !== phpFilesStamp) {
    console.log('[dev] 🔄 تم كشف تعديل على ملفات PHP — إعادة تحميل الخادم');
    await bootPhp();
  }

  const payload = {
    method: req.method,
    uri: url.pathname + url.search,
    query: url.search.slice(1),
    path: url.pathname,
    headers,
    get,
    post,
    body: rawBody || '',
    // __nopreload=1 يحاكي استضافة حقيقية بلا تحميل مسبق للكلاسات (لاختبار التحميل التلقائي)
    noPreload: url.searchParams.has('__nopreload'),
  };
  try {
    await php.writeFile('/request.json', JSON.stringify(payload));
  } catch (e) {
    throw new Error('writeFile /request.json فشل: ' + (e?.name || '') + ' errno=' + (e?.errno ?? '?'));
  }

  const code = await php.run(`<?php
$GLOBALS['__trix_response'] = null;
require '/dev/bridge.php';
`);
  void code;
  let raw;
  try {
    raw = await php.readFile('/response.json', { encoding: 'utf8' });
  } catch (e) {
    throw new Error('readFile /response.json فشل: ' + (e?.name || '') + ' errno=' + (e?.errno ?? '?'));
  }
  return JSON.parse(raw);
}

/** مزامنة قاعدة البيانات إلى القرص (بعد كل طلب) */
async function syncDb() {
  try {
    await php.run(`<?php
if (class_exists('PDO')) {
  try { $p = new PDO('sqlite:${WASM_DB}'); $p->exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (Throwable $e) {}
}
echo 'ok';`);
    const data = await php.readFile(WASM_DB);
    fs.writeFileSync(DB_ON_DISK, Buffer.from(data));
  } catch (err) {
    console.warn('[dev] تعذّر مزامنة قاعدة البيانات:', err?.message || err);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.map': 'application/json',
};

function serveStatic(req, res, pathname) {
  if (!fs.existsSync(CLIENT_DIST)) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'واجهة React غير مبنية — شغّل npm run build في client' }));
    return;
  }
  let filePath = path.join(CLIENT_DIST, pathname);
  if (!filePath.startsWith(CLIENT_DIST)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(CLIENT_DIST, 'index.html');
  }
  const ext = path.extname(filePath).toLowerCase();
  const data = fs.readFileSync(filePath);
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(data);
}

async function devProbe(filePath) {
  const out = {};
  try {
    out.errorsLog = await php.readFile('/data/errors.log', { encoding: 'utf8' });
  } catch (e) { out.errorsLog = '(لا يوجد) ' + (e?.message || ''); }
  try {
    out.config = await php.readFile('/config.php', { encoding: 'utf8' });
  } catch (e) { out.config = '(تعذّر) ' + (e?.message || ''); }
  try { out.dbExists = !!(await php.stat(WASM_DB)); } catch { out.dbExists = false; }
  try { out.response = await php.readFile('/response.json', { encoding: 'utf8' }); } catch { out.response = null; }
  try { out.bridgeExists = !!(await php.stat('/dev/bridge.php')); } catch { out.bridgeExists = false; }
  if (filePath) {
    try { out.file = await php.readFile(filePath, { encoding: 'utf8' }); } catch (e) { out.file = 'ERR ' + (e?.message || ''); }
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/__dev/sql') {
    const q = url.searchParams.get('q') || 'SELECT 1';
    await php.writeFile('/dev/q.sql', q);
    await php.run(`<?php
try {
  $p = new PDO('sqlite:/data/trix.sqlite');
  $p->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  $q = trim(file_get_contents('/dev/q.sql'));
  $st = $p->query($q);
  $rows = $st ? $st->fetchAll(PDO::FETCH_ASSOC) : [];
  file_put_contents('/dev/q.json', json_encode(['ok' => true, 'rows' => $rows], JSON_UNESCAPED_UNICODE));
} catch (Throwable $e) {
  file_put_contents('/dev/q.json', json_encode(['ok' => false, 'error' => $e->getMessage()]));
}
echo 'x';`);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(await php.readFile('/dev/q.json', { encoding: 'utf8' }));
    return;
  }
  if (url.pathname === '/__dev/state') {
    const probe = await devProbe(url.searchParams.get('file'));
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(probe, null, 1));
    return;
  }
  const isApi = url.pathname.startsWith('/api') || url.pathname === '/index.php' || url.pathname === '/install.php' || url.searchParams.has('r');

  if (!isApi) {
    serveStatic(req, res, url.pathname);
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');
  const started = Date.now();
  try {
    const result = await runPhp(req, rawBody);
    const body = JSON.stringify(result.data);
    res.writeHead(result.code || 200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    res.end(body);
    await syncDb();
    if (process.env.TRIX_DEV_VERBOSE) {
      console.log(`[php] ${req.method} ${req.url} → ${result.code} (${Date.now() - started}ms)`);
    }
  } catch (err) {
    console.error('[dev] خطأ:', err);
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err), stack: String(err && err.stack || '').split('\n').slice(0, 4) }));
  }
});

await bootPhp();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[dev] 🚀 خادم PHP المحلي يعمل على http://127.0.0.1:${PORT}`);
  console.log(`[dev]    اختبر الصحة: http://127.0.0.1:${PORT}/index.php?r=health`);
  console.log('[dev]    الملفات الثابتة (client/dist) تُخدم من نفس المنفذ إن وُجدت');
});
