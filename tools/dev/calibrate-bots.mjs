/**
 * قياس أداء البوتات: نسبة نجاح الطلبات، توزيع الطلبات، وطول المباريات
 *   node tools/dev/calibrate-bots.mjs [rounds]
 * المعيار الصحي: نسبة نجاح 55%–75%، متوسط طلب 7.4–8.6، ومباراة تنتهي في 5–14 جولة.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const ENTRY = path.join('/tmp', `trix-calib-entry-${process.pid}.ts`);
const OUT = path.join('/tmp', `trix-calib-${process.pid}.mjs`);
const esbuild = path.join(ROOT, 'client', 'node_modules', '.bin', 'esbuild');
fs.writeFileSync(
  ENTRY,
  `export { OfflineMatch } from '${ROOT}/client/src/game/offline';\nexport { handStrength, estimateTricks } from '${ROOT}/client/src/game/bots';\n`,
);
execFileSync(esbuild, [ENTRY, '--bundle', '--format=esm', '--platform=node', '--log-level=warning', `--outfile=${OUT}`]);
const { OfflineMatch, handStrength } = await import(pathToFileURL(OUT).href);

const TARGET_ROUNDS = Number(process.argv[2] || 400);
const stats = new Map();
let rounds = 0;
let matches = 0;
let totalMatchRounds = 0;
let strengthCaptured = null;

while (rounds < TARGET_ROUNDS) {
  const m = new OfflineMatch({ playerName: 'قياس', avatar: '📊', target: 31 });
  matches++;
  let guard = 0;
  let guardRounds = 0;
  strengthCaptured = null;
  while (m.phase !== 'game_end' && guard++ < 40000 && rounds < TARGET_ROUNDS) {
    if (m.phase === 'round_end') {
      const s = m.summary;
      if (s) {
        const rec = stats.get(s.bid) ?? { made: 0, failed: 0, tricksSum: 0, strength: [] };
        if (s.made) rec.made++;
        else rec.failed++;
        rec.tricksSum += s.teamTricks;
        if (strengthCaptured !== null) rec.strength.push(strengthCaptured);
        stats.set(s.bid, rec);
        rounds++;
        guardRounds++;
        totalMatchRounds++;
      }
      strengthCaptured = null;
      m.nextRound();
      continue;
    }
    if (m.phase === 'playing' && strengthCaptured === null && m.bidSeat !== null && m.trump !== null) {
      strengthCaptured = handStrength(m.hands[m.bidSeat]);
    }
    if (m.trick.length === 4) {
      m.resolveTrick();
      continue;
    }
    m.botStep(true);
  }
  void guardRounds;
}

console.log(`\n📊 نتائج ${rounds} جولة من ${matches} مباراة\n`);
console.log('الطلب | مرات | نجح | فشل | نسبة النجاح | متوسط الأكلات | متوسط قوة اليد');
let madeAll = 0;
let bidSum = 0;
for (const bid of [...stats.keys()].sort((a, b) => a - b)) {
  const r = stats.get(bid);
  const n = r.made + r.failed;
  madeAll += r.made;
  bidSum += bid * n;
  const st = r.strength.length ? (r.strength.reduce((a, b) => a + b, 0) / r.strength.length).toFixed(2) : '—';
  console.log(
    `  ${String(bid).padStart(2)}  | ${String(n).padStart(4)} | ${String(r.made).padStart(3)} | ${String(r.failed).padStart(3)} | ${String(Math.round((r.made / n) * 100)).padStart(3)}%        | ${(r.tricksSum / n).toFixed(2).padStart(13)} | ${st}`,
  );
}
console.log(
  `\nالإجمالي: نسبة نجاح ${Math.round((madeAll / rounds) * 100)}% | متوسط الطلب ${(bidSum / rounds).toFixed(2)} | متوسط الجولات لكل مباراة ${(totalMatchRounds / matches).toFixed(1)}`,
);
fs.rmSync(ENTRY, { force: true });
fs.rmSync(OUT, { force: true });
