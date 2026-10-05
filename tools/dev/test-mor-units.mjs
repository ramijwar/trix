/**
 * اختبار وحدات لمحرّك المور (قوانين النزول والمشاريع والإغلاق والحساب)
 * يشغّل PHP حقيقياً عبر php-wasm ويستدعي Mor:: مباشرة — سريع ودقيق.
 *   cd tools/dev && node test-mor-units.mjs
 */
import { PhpNode } from 'php-wasm/PhpNode.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '..', '..', 'server');

const php = new PhpNode({ version: '8.4', autoTransaction: true });
await php.refresh();

// نحمّل محرّك الطرنيب (لأن Mor يعتمد على Engine في القيم والخلط) + محرّك المور
await php.writeFile('/engine.php', fs.readFileSync(path.join(SERVER, 'src/Game/Engine.php'), 'utf8'));
await php.writeFile('/mor.php', fs.readFileSync(path.join(SERVER, 'src/Game/Mor.php'), 'utf8'));

const runner = fs.readFileSync(path.join(__dirname, 'mor-units.php'), 'utf8');

await php.run(`<?php @mkdir('/src/Core', 0777, true); @mkdir('/src/Game', 0777, true);`);
await php.writeFile('/src/Core/Config.php', `<?php
declare(strict_types=1);
namespace Trix\\Core;
/** بديل مبسّط للإعدادات أثناء اختبار الوحدات */
final class Config
{
    public static function get(string $key, mixed $default = null): mixed { return $default; }
    public static function init(array $config): void {}
}
`);
await php.writeFile('/units-runner.php', runner);
const status = await php.run(`<?php
register_shutdown_function(function () {
    $e = error_get_last();
    if ($e) { @file_put_contents('/fatal2.txt', json_encode($e, JSON_UNESCAPED_UNICODE)); }
});
try {
    require '/units-runner.php';
} catch (\\Throwable $e) {
    @file_put_contents('/fatal.txt', get_class($e) . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
}
`);
if (status !== 0) {
  console.log('PHP exit=' + status);
  for (const f of ['/fatal.txt', '/fatal2.txt']) {
    try { console.log('ERR ' + f + ': ' + (await php.readFile(f, { encoding: 'utf8' }))); } catch { /* لا ملف */ }
  }
}
let raw;
try {
  raw = JSON.parse(await php.readFile('/units.json', { encoding: 'utf8' }));
} catch (e) {
  console.error('تعذّر قراءة نتائج الاختبار:', e?.message || e);
  for (const f of ['/fatal.txt', '/fatal2.txt']) {
    try { console.error(f + ': ' + (await php.readFile(f, { encoding: 'utf8' }))); } catch { /* لا ملف */ }
  }
  process.exit(1);
}

let pass = 0;
let fail = 0;
for (const t of raw) {
  if (t.ok) {
    pass++;
    console.log(`  ✅ ${t.label}`);
  } else {
    fail++;
    console.log(`  ❌ ${t.label} — ${t.extra}`);
  }
}
console.log(`\n================================================\n✅ ناجح: ${pass}   ❌ فاشل: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
