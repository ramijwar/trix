/**
 * تجهيز أدوات بناء APK (تعمل بدون Android Studio وبدون Gradle)
 * ------------------------------------------------------------------
 *   node tools/android/setup-toolchain.mjs
 *
 * تُنزّل الأدوات من مصادر متاحة على npm و PyPI:
 *   - @drxiaozhi/minapk : android.jar + d8.jar + apksigner.jar + ecj (مترجم جافا) + مفتاح تجريبي
 *   - aaptjs3           : aapt2 (نسخة لينكس)
 *   - jdk4py            : بيئة تشغيل Java (JRE) لتشغيل الأدوات
 *
 * المخرجات في: ~/.cache/trix-android-toolchain
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_TOOLCHAIN = process.env.TRIX_TOOLCHAIN || path.join(os.homedir(), '.cache', 'trix-android-toolchain');

const TOOLCHAIN = process.argv.includes('--toolchain')
  ? process.argv[process.argv.indexOf('--toolchain') + 1]
  : DEFAULT_TOOLCHAIN;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'trix-toolchain-'));

function log(...a) {
  console.log('[toolchain]', ...a);
}

function run(cmd, args, opts = {}) {
  log('$', cmd, args.join(' '));
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function has(cmd) {
  try {
    execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function npmPack(spec) {
  const out = execFileSync('npm', ['pack', spec, '--pack-destination', TMP], { encoding: 'utf8' }).trim().split('\n').pop();
  return path.join(TMP, out);
}

function extract(tgz, dest, only) {
  fs.mkdirSync(dest, { recursive: true });
  const args = ['-xf', tgz, '-C', dest];
  if (only) args.push(only);
  run('tar', args);
}

export function ensureToolchain(dir = TOOLCHAIN) {
  const tools = path.join(dir, 'tools');
  const jdk = path.join(dir, 'jdk');
  fs.mkdirSync(tools, { recursive: true });
  fs.mkdirSync(path.join(dir, 'keystore'), { recursive: true });

  const need = {
    'tools/android.jar': path.join(tools, 'android.jar'),
    'tools/d8.jar': path.join(tools, 'd8.jar'),
    'tools/apksigner.jar': path.join(tools, 'apksigner.jar'),
    'tools/ecj.jar': path.join(tools, 'ecj.jar'),
    'tools/aapt2': path.join(tools, 'aapt2'),
    'jdk/bin/java': path.join(jdk, 'bin', 'java'),
  };

  if (Object.values(need).every((p) => fs.existsSync(p))) {
    log('الأدوات جاهزة مسبقاً في', dir);
    return dir;
  }

  log('تنزيل الأدوات إلى', dir);
  if (!has('npm')) throw new Error('npm مطلوب لتجهيز الأدوات');
  if (!has('unzip')) throw new Error('unzip مطلوب لفك الحزم');

  // 1) أدوات أندرويد من minapk
  const minapk = npmPack('@drxiaozhi/minapk@0.4.0');
  extract(minapk, TMP + '/minapk');
  const mt = path.join(TMP, 'minapk', 'package', 'tools');
  fs.copyFileSync(path.join(mt, 'android.jar'), need['tools/android.jar']);
  fs.copyFileSync(path.join(mt, 'd8.jar'), need['tools/d8.jar']);
  fs.copyFileSync(path.join(mt, 'apksigner.jar'), need['tools/apksigner.jar']);
  fs.copyFileSync(path.join(mt, 'ecj-3.45.0.jar'), need['tools/ecj.jar']);
  log('✔ android.jar + d8 + apksigner + ecj');

  // 2) aapt2 (لينكس)
  const aaptjs = npmPack('aaptjs3@2.0.2');
  extract(aaptjs, TMP + '/aaptjs');
  const aapt2 = path.join(TMP, 'aaptjs', 'package', 'bin', 'x64', 'linux', 'aapt2');
  if (!fs.existsSync(aapt2)) throw new Error('لم يتم العثور على aapt2 داخل حزمة aaptjs3');
  fs.copyFileSync(aapt2, need['tools/aapt2']);
  fs.chmodSync(need['tools/aapt2'], 0o755);
  log('✔ aapt2');

  // 3) بيئة Java من jdk4py (عبر PyPI)
  const jdkDir = path.join(TMP, 'jdkpkg');
  fs.mkdirSync(jdkDir, { recursive: true });
  let javaOk = false;
  const py = has('python3') ? 'python3' : has('python') ? 'python' : null;
  if (py) {
    try {
      run(py, ['-m', 'pip', 'download', 'jdk4py', '--no-deps', '--only-binary=:all:', '-d', jdkDir]);
      const wheel = fs.readdirSync(jdkDir).find((f) => f.endsWith('.whl'));
      if (wheel) {
        // ملفات whl هي أرشيف zip وليست tar
        fs.mkdirSync(path.join(TMP, 'jdkx'), { recursive: true });
        run('unzip', ['-q', '-o', path.join(jdkDir, wheel), '-d', path.join(TMP, 'jdkx')]);
        const runtime = path.join(TMP, 'jdkx', 'jdk4py', 'java-runtime');
        if (fs.existsSync(path.join(runtime, 'bin', 'java'))) {
          fs.cpSync(runtime, jdk, { recursive: true });
          for (const f of fs.readdirSync(path.join(jdk, 'bin'))) {
            try {
              fs.chmodSync(path.join(jdk, 'bin', f), 0o755);
            } catch {
              /* مجلدات */
            }
          }
          javaOk = true;
          log('✔ java runtime (jdk4py)');
        }
      }
    } catch (e) {
      log('⚠ تعذّر تنزيل jdk4py:', e.message);
    }
  }
  if (!javaOk) {
    const systemJava = (() => {
      try {
        return execFileSync('sh', ['-c', 'command -v java'], { encoding: 'utf8' }).trim();
      } catch {
        return '';
      }
    })();
    if (systemJava) {
      fs.mkdirSync(path.join(jdk, 'bin'), { recursive: true });
      fs.symlinkSync(systemJava, path.join(jdk, 'bin', 'java'));
      log('✔ استخدام java المثبّت في النظام');
    } else {
      throw new Error('لا توجد بيئة Java: ثبّت Java أو تأكد من عمل pip');
    }
  }

  log('✅ اكتمل تجهيز الأدوات في', dir);
  return dir;
}

if (process.argv[1] && process.argv[1].endsWith('setup-toolchain.mjs')) {
  ensureToolchain(TOOLCHAIN);
  console.log('');
  console.log('الخطوة التالية:  node tools/android/build-apk.mjs');
}
