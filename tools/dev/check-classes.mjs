/**
 * فحص سلامة أسماء الكلاسات ومساراتها (مهم للنشر على استضافة Linux حساسة لحالة الأحرف)
 *   cd tools/dev && node check-classes.mjs
 *
 * يتحقق أن كل استخدام لـ Trix\X\Y له ملف src/X/Y.php بنفس الاسم تماماً،
 * وأن اسم الكلاس داخل الملف مطابق — نفس الخطأ الذي يظهر على الاستضافة
 * كـ Class "Trix\Core\Config" not found.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, '../../server');
const SRC = path.join(SERVER, 'src');

const phpFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.php')) phpFiles.push(full);
  }
})(SRC);

const roots = [...phpFiles, path.join(SERVER, 'index.php'), path.join(SERVER, 'install.php')];

/** إزالة التعليقات حتى لا نلتقط أسماء من الأمثلة داخل الشرح */
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const NS_RE = new RegExp(String.raw`Trix\\([A-Za-z0-9_]+)\\([A-Za-z0-9_]+)`, 'g');
const used = new Set();
for (const file of roots) {
  const text = stripComments(fs.readFileSync(file, 'utf8'));
  for (const m of text.matchAll(NS_RE)) used.add(m[1] + '/' + m[2]);
}

// خرائط الكلاسات المعرّفة فعلاً: الاسم → الملف
const declaredIn = new Map();
for (const file of phpFiles) {
  const text = stripComments(fs.readFileSync(file, 'utf8'));
  for (const m of text.matchAll(/^\s*(?:final\s+|abstract\s+)?(?:class|interface|trait)\s+([A-Za-z0-9_]+)/gm)) {
    declaredIn.set(m[1], file);
  }
}

let ok = 0;
const notes = [];
const problems = [];
for (const cls of [...used].sort()) {
  const file = path.join(SRC, cls + '.php');
  if (!fs.existsSync(file)) {
    const name = cls.split('/')[1];
    if (declaredIn.has(name)) {
      notes.push(`ℹ️  ${name} معرّف داخل ${path.relative(SRC, declaredIn.get(name))} (يجب أن يُحمَّل من bootstrap)`);
      ok++;
      continue;
    }
    problems.push(`❌ لا يوجد ملف للكلاس Trix\\${cls.split('/').join('\\')}  (المتوقع: src/${cls}.php)`);
    continue;
  }
  const name = cls.split('/')[1];
  const text = fs.readFileSync(file, 'utf8');
  if (!new RegExp(String.raw`(class|interface|trait)\s+${name}\b`).test(text)) {
    problems.push(`⚠️  اسم الكلاس داخل src/${cls}.php لا يطابق ${name}`);
    continue;
  }
  ok++;
}

const declared = [];
for (const file of phpFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/^\s*(?:final\s+|abstract\s+)?(?:class|interface|trait)\s+([A-Za-z0-9_]+)/gm)) {
    declared.push(`${path.relative(SRC, file)} → ${m[1]}`);
  }
}

console.log(`✅ كلاسات مُستخدمة وموجودة: ${ok}/${used.size}`);
console.log(`📦 كلاسات معرّفة في الخادم: ${declared.length}`);
for (const n of notes) console.log(n);
for (const p of problems) console.log(p);
process.exit(problems.length ? 1 : 0);
