/**
 * فحص سريع لكل ملفات PHP في الخادم (أخطاء الصياغة) بدون الحاجة إلى تثبيت PHP
 *   cd tools/dev && node lint-php.mjs
 */
import { PhpNode } from 'php-wasm/PhpNode.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', '..', 'server');

function collect(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'data') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.name.endsWith('.php')) out.push(full);
  }
  return out;
}

const files = collect(SERVER_DIR).filter((f) => !f.includes('install.php'));
console.log(`[lint] فحص ${files.length} ملف PHP ...`);

const php = new PhpNode({ version: '8.4', autoTransaction: true });
await php.refresh();

const report = [];
for (const file of files) {
  const code = fs.readFileSync(file, 'utf8');
  await php.writeFile('/lint-target.php', code);
  const result = await php.run(`<?php
$out = [];
try {
    token_get_all(file_get_contents('/lint-target.php'), TOKEN_PARSE);
    $out['ok'] = true;
} catch (\\ParseError $e) {
    $out['ok'] = false;
    $out['error'] = $e->getMessage();
    $out['line'] = $e->getLine();
} catch (\\Throwable $e) {
    $out['ok'] = false;
    $out['error'] = $e->getMessage();
    $out['line'] = $e->getLine();
}
file_put_contents('/lint-result.json', json_encode($out));
`);
  void result;
  const raw = JSON.parse(await php.readFile('/lint-result.json', { encoding: 'utf8' }));
  report.push({ file: path.relative(SERVER_DIR, file), ...raw });
}

let failed = 0;
for (const r of report) {
  if (r.ok) {
    console.log(`  ✅ ${r.file}`);
  } else {
    failed++;
    console.log(`  ❌ ${r.file} — سطر ${r.line}: ${r.error}`);
  }
}
console.log(failed === 0 ? '[lint] كل الملفات سليمة ✅' : `[lint] ${failed} ملف به أخطاء ❌`);
process.exit(failed === 0 ? 0 : 1);
