/**
 * اختبار محرك اللعب المحلي (نفس قوانين الخادم) — يلعب مباريات كاملة بالبوتات
 *   cd tools/dev && node test-offline.mjs
 * يُجمّع ملفات TypeScript أولاً عبر esbuild من client/node_modules.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join('/tmp', `trix-offline-${process.pid}.mjs`);

const esbuild = path.join(ROOT, 'client', 'node_modules', '.bin', 'esbuild');
if (!fs.existsSync(esbuild)) {
  console.error('❌ esbuild غير متوفّر — نفّذ npm install داخل client أولاً');
  process.exit(1);
}

execFileSync(esbuild, [
  path.join(ROOT, 'client', 'src', 'game', 'offline.ts'),
  '--bundle', '--format=esm', '--platform=node', '--log-level=warning',
  `--outfile=${OUT}`,
]);
// esbuild يشير إلى وحدة فارغة للأنماط — نضيف تصديراً نظيفاً
const mod = await import(pathToFileURL(OUT).href);
const { OfflineMatch } = mod;

let failures = 0;
const check = (cond, label) => {
  if (!cond) {
    failures++;
    console.error('❌', label);
  }
};

function playFullMatch(match, label) {
  let guard = 0;
  let rounds = 0;
  let tricks = 0;
  while (match.phase !== 'game_end' && guard++ < 20000) {
    if (match.phase === 'round_end') {
      rounds++;
      match.nextRound();
      continue;
    }
    if (match.trick.length === 4) {
      match.resolveTrick();
      tricks++;
      continue;
    }
    const seat = match.turn;
    const before = match.hands ? null : null;
    void before;
    match.botStep(true);
    // حماية من التوقف
    if (match.turn === seat && match.phase === 'playing' && match.trick.length < 4) {
      // لا تقدّم؟ نلعب يدوياً أول ورقة قانونية
      const legal = match.legalCards(seat);
      if (legal.length) match.play(seat, legal[0]);
    }
  }
  const snapshot = match.snapshot();
  console.log(
    `   ${label}: ${rounds} جولة • النتيجة ${snapshot.scores[0]}-${snapshot.scores[1]} • الفائز: ${snapshot.winnerTeam} • الأكلات الكلية: ${tricks}`,
  );
  check(match.phase === 'game_end', `${label}: لم تنتهِ المباراة (guard=${guard})`);
  check(snapshot.scores[0] >= snapshot.target || snapshot.scores[1] >= snapshot.target, `${label}: لم يصل أي فريق للهدف`);
  check(tricks % 13 === 0, `${label}: عدد الأكلات ليس من مضاعفات 13 (${tricks})`);
  return { rounds, tricks, snapshot };
}

console.log('🎮 اختبار محرك الطرنيب المحلي (مباريات كاملة بالبوتات)\n');
for (let i = 1; i <= 3; i++) {
  const match = new OfflineMatch({
    playerName: 'المختبر',
    avatar: '🦊',
    target: 31,
    settings: { target: 31, allowDouble: i === 2, allowNoTrump: i === 3, turnTime: 0, bidTime: 0, sound: true },
  });
  playFullMatch(match, `مباراة ${i}`);
}

/* فحص قوانين إضافية */
console.log('\n🔍 فحص القوانين:');
const m = new OfflineMatch({ playerName: 'فاحص', avatar: '🧪', target: 31 });
check(m.snapshot().myHand.length === 13, 'توزيع 13 ورقة للاعب');
check(m.snapshot().handCounts.every((c) => c === 13), 'توزيع 13 ورقة للجميع');
check(m.seats[(m.mySeat + 2) % 4].team === m.seats[m.mySeat].team, 'الشريك هو المقابل (نفس الفريق)');
check(m.seats[(m.mySeat + 1) % 4].team !== m.seats[m.mySeat].team, 'اللاعب المجاور من الفريق الخصم');

// المزايدة: 7 ثم 8 ثم ... والتمرير
let steps = 0;
while (m.phase === 'bidding' && steps++ < 60) {
  const seat = m.turn;
  if (m.mustChooseTrump()) {
    m.chooseTrump(seat, 'S');
    break;
  }
  const legal = m.legalBids();
  if (legal.length) m.bid(seat, legal[0]);
  else m.pass(seat);
}
check(m.phase === 'playing', 'انتهى المزاد وبدأ اللعب');
check(m.trump !== null, 'تم اختيار الطرنيب');

// قانون اتباع اللون
const leadSeat = m.turn;
const legalLead = m.legalCards(leadSeat);
m.play(leadSeat, legalLead[0]);
const ledSuit = m.snapshot().trick[0].card[0];
const actor = m.turn;
const actorHand = m.snapshot().myHand.length >= 0 ? null : null;
void actorHand;
// نتحقق على مستوى المحرك: الأوراق القانونية إما كلها من لون البداية أو اللاعب لا يملك اللون
const legalNow = m.legalCards(actor);
check(legalNow.length > 0, 'يوجد دائماً لعب قانوني');
const hasLed = m.hands[actor].some((c) => c.s === ledSuit);
check(
  hasLed ? legalNow.every((c) => c[0] === ledSuit) : true,
  'قانون اتباع اللون: يجب لعب لون البداية عند توفّره',
);
check(
  !hasLed ? legalNow.length === m.hands[actor].length : true,
  'اللاعب الحر (بلا لون البداية) يستطيع لعب أي ورقة',
);

// قانون حسم الأكلة: يكمل أربع أوراق
let guard2 = 0;
while (m.trick.length < 4 && guard2++ < 10) {
  const s2 = m.turn;
  const legal = m.legalCards(s2);
  m.play(s2, legal[0]);
}
check(m.trick.length === 4, 'اكتملت الأكلة بأربع أوراق');
const winner = m.resolveTrick();
check(winner >= 0 && winner < 4, 'تم تحديد فائز الأكلة');
const totalTricks = m.tricksWon[0] + m.tricksWon[1];
check(totalTricks === 1, 'حُسبت أكلة واحدة بعد الحسم');

console.log(failures === 0 ? '\n✅ كل الفحوصات ناجحة' : `\n⚠️ فشل ${failures} فحص`);
fs.rmSync(OUT, { force: true });
process.exit(failures === 0 ? 0 : 1);
