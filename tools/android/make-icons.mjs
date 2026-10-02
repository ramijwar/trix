/**
 * توليد أيقونات التطبيق (PNG) باستخدام ImageMagick
 *   node tools/android/make-icons.mjs
 * المخرجات: tools/android/res/mipmap-<density>/ic_launcher.png + ic_launcher_round.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(__dirname, 'res');

export const ICON_SIZES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

/** أوامر الرسم بمقاس 192x192 — شكل الورقتين (قلب + بستوني) */
function drawArgs(round) {
  const frame = round
    ? ['-fill', '#0f3a29', '-draw', 'circle 96,96 96,0', '-fill', 'none', '-stroke', '#d4af37', '-strokewidth', '6', '-draw', 'circle 96,96 94,0']
    : [
        '-fill', '#0f3a29', '-stroke', '#1d6d4d', '-strokewidth', '2', '-draw', 'roundrectangle 1,1 190,190 34,34',
        '-fill', 'none', '-stroke', '#d4af37', '-strokewidth', '5', '-draw', 'roundrectangle 9,9 182,182 27,27',
      ];
  return [
    '-size', '192x192', 'xc:none',
    ...frame,
    '-fill', '#f8fafc', '-stroke', '#0b1220', '-strokewidth', '2',
    '-draw', 'translate 80,98 rotate -13 roundrectangle -31,-45 31,45 9,9',
    '-fill', '#c81e2b', '-stroke', 'none',
    '-draw',
    "translate 80,100 path 'M0,-22 C-10,-30 -24,-20 -19,-8 C-14,3 0,13 0,13 S14,3 19,-8 C24,-20 10,-30 0,-22 Z'",
    '-fill', '#f8fafc', '-stroke', '#0b1220', '-strokewidth', '2',
    '-draw', 'translate 118,104 rotate 12 roundrectangle -31,-45 31,45 9,9',
    '-fill', '#0b1220', '-stroke', '#0b1220', '-strokewidth', '1',
    '-draw',
    "translate 118,100 path 'M0,-20 C-7,-11 -20,-3 -20,7 C-20,15 -12,19 -6,16 C-2,14 0,11 0,11 C0,11 2,14 6,16 C12,19 20,15 20,7 C20,-3 7,-11 0,-20 Z'",
    '-draw', "translate 118,102 path 'M-4,6 L-8,20 L8,20 L4,6 Z'",
  ];
}

export function makeIcons() {
  let convert = '';
  try {
    convert = execFileSync('sh', ['-c', 'command -v convert || command -v magick || true'], { encoding: 'utf8' }).trim();
  } catch {
    convert = '';
  }
  if (!convert) {
    console.log('[icons] ⚠ لا يوجد ImageMagick — الأيقونات الموجودة في tools/android/res ستُستخدم كما هي');
    return false;
  }

  const master = path.join(RES, '_master.png');
  fs.mkdirSync(RES, { recursive: true });

  for (const [density, size] of Object.entries(ICON_SIZES)) {
    const dir = path.join(RES, `mipmap-${density}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const round of [false, true]) {
      const name = round ? 'ic_launcher_round.png' : 'ic_launcher.png';
      execFileSync(convert, [...drawArgs(round), '-depth', '8', '-define', 'png:color-type=6', master]);
      execFileSync(convert, ['-background', 'none', master, '-resize', `${size}x${size}`, '-depth', '8', '-define', 'png:color-type=6', path.join(dir, name)]);
    }
    console.log(`[icons] ✔ mipmap-${density} (${size}px)`);
  }
  fs.rmSync(master, { force: true });

  // صورة شاشة البداية (غلاف أندرويد اختياري)
  const splashDir = path.join(RES, 'drawable');
  fs.mkdirSync(splashDir, { recursive: true });
  execFileSync(convert, [...drawArgs(false), '-depth', '8', '-define', 'png:color-type=6', master]);
  execFileSync(convert, [
    '-size', '720x1280', 'xc:#061410',
    '(', master, '-resize', '320x320', ')',
    '-gravity', 'center', '-composite',
    '-depth', '8', '-define', 'png:color-type=6',
    path.join(splashDir, 'splash.png'),
  ]);
  fs.rmSync(master, { force: true });
  console.log('[icons] ✔ drawable/splash.png');
  return true;
}

if (process.argv[1] && process.argv[1].endsWith('make-icons.mjs')) {
  console.log(makeIcons() ? 'تم توليد الأيقونات ✅' : 'تعذّر توليد الأيقونات');
}
