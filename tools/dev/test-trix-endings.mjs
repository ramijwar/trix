/**
 * اختبار نهايات تسميات التركس (عبر HTTP على خادم حقيقي + بوتات)
 *   cd tools/dev && node test-trix-endings.mjs [عدد الممالك]
 *
 * يتحقق من القاعدة الجديدة:
 *   - ختيار الكبة: تنتهي التسمية بمجرد أكل K♥ (٢٥ بالمئة من الأوراق كحد أقصى مطلوب).
 *   - البنات: تنتهي عند أكل البنات الأربع.
 *   - الديناري: تنتهي عند أكل كل الديناري (١٣).
 *   - اللطوش/التركس: تُكمل كل الأوراق (لا نهاية مبكرة).
 */
const BASE = process.env.TRIX_API || 'http://127.0.0.1:8095/index.php?r=';
const NO_PRELOAD = process.env.TRIX_NOPRELOAD ? '&__nopreload=1' : '';
const KINGDOMS = Number(process.argv[2] || 1);

let token = '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(route, body = {}, method = 'POST') {
  const res = await fetch(BASE + route + NO_PRELOAD, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  return res.json();
}

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

const u = await api('auth/register', { username: 'end' + Date.now().toString(36), password: '123456', name: 'فحص النهايات', avatar: '🧪' });
token = u.token;
const room = (await api('room/create', { name: 'فحص نهايات التركس', settings: { game: 'trix', kingdoms: KINGDOMS, allowDouble: true, turnTime: 30 } })).room;
console.log('▶️ غرفة:', room.roomCode);
await api('room/bot/add', { room: room.roomId });
await api('room/bot/add', { room: room.roomId });
await api('room/bot/add', { room: room.roomId });
let st = (await api('room/start', { room: room.roomId })).room;

const seen = {};        // contract -> عدد التوزيعات التي ظهرت
const okPenalty = {};   // contract -> هل كل توزيعاته انتهت بالقاعدة الجديدة
let guard = 0;
let finished = false;

while (guard++ < 6000 && !finished) {
  st = (await api('room/poll', { room: room.roomId, since: 0, wait: 1 })).room;
  if (!st) continue;
  const tx = st.trix || {};

  if (st.phase === 'game_end') {
    finished = true;
    break;
  }

  if (st.phase === 'round_end') {
    const sum = st.lastRoundSummary;
    const tricks = (tx.trickCounts || []).reduce((a, b) => a + b, 0);
    const handsLeft = (st.handCounts || []).reduce((a, b) => a + b, 0);
    const pc = sum.penaltyCounts || {};
    const kbeh = pc.kbeh ?? 0;
    const queens = pc.queen ?? 0;
    const diamonds = pc.diamond ?? 0;
    console.log(
      `   ↳ ${sum.dealNo}. ${sum.contractAr} [${sum.endReason}] أكلات=${tricks} متبقٍ=${handsLeft} ` +
        `كبة=${kbeh} بنات=${queens} ديناري=${diamonds} نقاط=[${sum.roundScores.join(', ')}]`,
    );
    seen[sum.contract] = (seen[sum.contract] || 0) + 1;
    // أوراق اللعب المتبقية يجب أن تكون دائماً من مضاعفات ٤ (كل أكلة ٤ أوراق)
    const consistent = handsLeft % 4 === 0 && handsLeft === 52 - 4 * tricks;
    let good = false;
    if (sum.contract === 'kbeh') {
      // تنتهي فور أكل الكبة: إما نهاية مبكرة (وصلت الكبة قبل آخر أكلة) أو صادف أنها آخر أكلة
      good = consistent && kbeh === 1 && (handsLeft > 0 ? sum.endReason === 'penalties' : true);
    } else if (sum.contract === 'queens') {
      good = consistent && queens === 4 && sum.endReason === 'penalties' && handsLeft > 0;
    } else if (sum.contract === 'diamonds') {
      // إن صادف آخر ديناري آخر أكلة فلا يمكن إنهاء التسمية قبلها
      good = consistent && diamonds === 13 && (handsLeft > 0 ? sum.endReason === 'penalties' : true);
    } else if (sum.contract === 'trix') {
      // التركس: كل لاعب يتخلص من أوراقه (لا تُحسب أكلات)
      good = sum.endReason === 'cards' && handsLeft === 0;
    } else {
      // اللطوش: تُلعب كل الأوراق دائماً
      good = consistent && sum.endReason === 'cards' && handsLeft === 0 && tricks === 13;
    }
    if (!okPenalty[sum.contract]) okPenalty[sum.contract] = true;
    if (!good) okPenalty[sum.contract] = false;
    await api('room/continue', { room: room.roomId });
    continue;
  }

  if (tx.revealPhase) {
    if (tx.canReveal?.length && Math.random() < 0.5) {
      await api('game/reveal', { room: room.roomId, card: tx.canReveal[0], done: true });
    } else if (!tx.revealReady) {
      await api('game/reveal', { room: room.roomId, done: true });
    }
    continue;
  }

  if (tx.mustChooseContract) {
    await api('game/contract', { room: room.roomId, contract: (tx.legalContracts || [])[0] });
    continue;
  }

  if (st.isMyTurn && st.phase === 'playing') {
    const legal = st.legalCards || [];
    if (!legal.length) {
      await sleep(80);
      continue;
    }
    await api('game/play', { room: room.roomId, card: legal[0] });
    continue;
  }
  await sleep(80);
}

console.log('\n📊 نتائج الفحص:');
check('انتهت المباراة', finished, st?.phase);
for (const c of ['kbeh', 'queens', 'diamonds', 'tricks', 'trix']) {
  check(`تسمية ${c} ظهرت وانتهت حسب القاعدة الجديدة`, seen[c] > 0 && okPenalty[c] === true, `عدد التوزيعات=${seen[c] || 0}`);
}
check('عدد التوزيعات = عدد الممالك × 5', Object.values(seen).reduce((a, b) => a + b, 0) === KINGDOMS * 5);
console.log(`\n✅ ناجح: ${pass}   ❌ فاشل: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
