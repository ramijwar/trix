/**
 * بناء ملف APK كامل بدون Gradle وبدون Android Studio
 * ------------------------------------------------------------------
 *   node tools/android/build-apk.mjs
 *
 * الخطوات:
 *   1) بناء واجهة React إلى client/dist-android  (base = ./)
 *   2) aapt2 compile + link  → resources.apk
 *   3) ecj (مترجم جافا) → .class ثم d8 → classes.dex
 *   4) دمج dex + assets/www داخل الـ apk (zip)
 *   5) zipalign ثم apksigner بمفتاح debug (أو مفتاحك الخاص)
 *
 * المخرجات: release/trix-android.apk
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureToolchain } from './setup-toolchain.mjs';
import { makeIcons } from './make-icons.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CLIENT = path.join(ROOT, 'client');
const DIST = path.join(CLIENT, 'dist-android');
const SHELL = path.join(__dirname, 'shell');
const RES = path.join(__dirname, 'res');
const RELEASE = path.join(ROOT, 'release');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'trix-apk-'));

const PACKAGE = 'com.trix.game';
const APP_LABEL = 'طرنيب أونلاين';

function log(...a) {
  console.log('[apk]', ...a);
}

function run(cmd, args, opts = {}) {
  log('$', path.basename(cmd), args.join(' ').slice(0, 220));
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function out(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts });
}

export function buildApk() {
  const toolchain = ensureToolchain();
  const T = path.join(toolchain, 'tools');
  const JAVA = path.join(toolchain, 'jdk', 'bin', 'java');
  const AAPT2 = path.join(T, 'aapt2');
  const ANDROID_JAR = path.join(T, 'android.jar');
  const D8 = path.join(T, 'd8.jar');
  const APKSIGNER = path.join(T, 'apksigner.jar');
  const ECJ = path.join(T, 'ecj.jar');
  const KEYSTORE = process.env.TRIX_KEYSTORE || path.join(toolchain, 'keystore', 'debug.keystore');
  const KS_PASS = process.env.TRIX_KEYSTORE_PASS || 'android';
  const KS_ALIAS = process.env.TRIX_KEYSTORE_ALIAS || 'androiddebugkey';
  const KEY_PASS = process.env.TRIX_KEYSTORE_KEY_PASS || KS_PASS;

  fs.mkdirSync(RELEASE, { recursive: true });

  // 0) الأيقونات
  if (!fs.existsSync(path.join(RES, 'mipmap-xxxhdpi', 'ic_launcher.png'))) {
    makeIcons();
  }

  // 1) بناء الواجهة
  log('بناء واجهة React (وضع أندرويد)…');
  if (!fs.existsSync(path.join(CLIENT, 'node_modules'))) {
    log('تثبيت حزم الواجهة…');
    run('npm', ['install', '--no-audit', '--no-fund'], { cwd: CLIENT });
  }
  run('npm', ['run', 'build:android'], { cwd: CLIENT });

  // 2) الموارد
  log('تجميع الموارد (aapt2 compile)…');
  const compiled = path.join(WORK, 'compiled');
  fs.mkdirSync(compiled, { recursive: true });
  run(AAPT2, ['compile', '--dir', RES, '-o', compiled]);

  const flatFiles = fs.readdirSync(compiled).filter((f) => f.endsWith('.flat')).map((f) => path.join(compiled, f));
  log(`ترابط الموارد (aapt2 link) — ${flatFiles.length} ملف…`);
  const resourcesApk = path.join(WORK, 'resources.apk');
  run(AAPT2, [
    'link',
    '-o', resourcesApk,
    '-I', ANDROID_JAR,
    '--manifest', path.join(SHELL, 'AndroidManifest.xml'),
    '--min-sdk-version', process.env.TRIX_MIN_SDK || '23',
    '--target-sdk-version', process.env.TRIX_TARGET_SDK || '34',
    '--version-code', '1',
    '--version-name', '1.0.0',
    '--java', path.join(WORK, 'gen'),
    ...flatFiles,
  ]);

  // 3) جافا → dex
  log('ترجمة جافا (ecj)…');
  const classesDir = path.join(WORK, 'classes');
  fs.mkdirSync(classesDir, { recursive: true });
  const javaFiles = [path.join(SHELL, 'java', 'com', 'trix', 'game', 'MainActivity.java')];
  const genDir = path.join(WORK, 'gen');
  if (fs.existsSync(genDir)) {
    const walk = (d) => {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.java')) javaFiles.push(p);
      }
    };
    walk(genDir);
  }
  run(JAVA, [
    '-jar', ECJ,
    '-source', '1.8', '-target', '1.8',
    '-nowarn', '-proc:none', '-encoding', 'UTF-8',
    '-bootclasspath', ANDROID_JAR,
    '-d', classesDir,
    ...javaFiles,
  ]);

  log('تحويل إلى dex (d8)…');
  const classFiles = [];
  const walkClasses = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walkClasses(p);
      else if (p.endsWith('.class')) classFiles.push(p);
    }
  };
  walkClasses(classesDir);
  const classesDex = path.join(WORK, 'classes.dex');
  run(JAVA, ['-cp', D8, 'com.android.tools.r8.D8', '--min-api', '23', '--lib', ANDROID_JAR, '--output', WORK, ...classFiles]);
  if (!fs.existsSync(path.join(WORK, 'classes.dex'))) {
    throw new Error('فشل توليد classes.dex');
  }

  // 4) الدمج: apk الموارد + dex + أصول الواجهة (assets/www)
  log('دمج dex وأصول الواجهة…');
  const apkDir = path.join(WORK, 'apk');
  fs.mkdirSync(apkDir, { recursive: true });
  run('unzip', ['-q', '-o', resourcesApk, '-d', apkDir]);
  fs.rmSync(path.join(apkDir, 'META-INF'), { recursive: true, force: true });
  fs.copyFileSync(classesDex, path.join(apkDir, 'classes.dex'));

  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    throw new Error('لم يتم العثور على build الواجهة: ' + DIST);
  }
  const www = path.join(apkDir, 'assets', 'www');
  fs.mkdirSync(www, { recursive: true });
  copyTree(DIST, www);

  // 5) الحزم + المحاذاة + التوقيع
  const unsigned = path.join(WORK, 'unsigned.apk');
  log('ضغط الحزمة…');
  run('sh', ['-c', `cd "${apkDir}" && zip -q -r -X "${unsigned}" .`]);

  const aligned = path.join(WORK, 'aligned.apk');
  log('محاذاة (zipalign)…');
  run('python3', [path.join(__dirname, 'zipalign.py'), unsigned, aligned, '4']);

  const signed = path.join(RELEASE, 'trix-android.apk');
  log('التوقيع (apksigner)…');
  if (!fs.existsSync(KEYSTORE)) {
    log('إنشاء مفتاح تجريبي…');
    run(path.join(toolchain, 'jdk', 'bin', 'keytool'), [
      '-genkeypair', '-keystore', KEYSTORE, '-alias', KS_ALIAS,
      '-storepass', KS_PASS, '-keypass', KEY_PASS,
      '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
      '-dname', 'CN=Trix Online, OU=Game, O=Trix, L=Damas, C=SY',
    ]);
  }
  run(JAVA, [
    '-jar', APKSIGNER, 'sign',
    '--ks', KEYSTORE, '--ks-pass', `pass:${KS_PASS}`,
    '--ks-key-alias', KS_ALIAS, '--key-pass', `pass:${KEY_PASS}`,
    '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true',
    '--out', signed, aligned,
  ]);

  const size = (fs.statSync(signed).size / (1024 * 1024)).toFixed(2);
  log(`✅ تم إنشاء الملف: ${signed} (${size} ميجابايت)`);
  return signed;
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (process.argv[1] && process.argv[1].endsWith('build-apk.mjs')) {
  try {
    buildApk();
  } catch (e) {
    console.error('❌ فشل البناء:', e.message);
    process.exit(1);
  }
}
