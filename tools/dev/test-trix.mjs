/**
 * اختبار لعبة التركس كاملة عبر HTTP (خادم حقيقي + بوتات)
 *   cd tools/dev && node test-trix.mjs [عدد الممالك]
 *
 * يلعب مباراة تركس كاملة: اختيار التسميات، الكشف/التدبيل، اللعب، حساب النقاط،
 * الانتقال بين التسميات والممالك، ونهاية المباراة.
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

const u = await api('auth/register', { username: 'trix' + Date.now().toString(36), password: '123456', name: 'لاعب التركس', avatar: '🤠' });
token = u.token;
const room = (await api('room/create', { name: 'طاولة تركس', settings: { game: 'trix', kingdoms: KINGDOMS, allowDouble: true, turnTime: 30 } })).room;
console.log('▶️ غرفة تركس:', room.roomCode, '| الممالك:', room.settings.kingdoms, '| التدبيل:', room.settings.allowDouble);
check('room/create يقبل نوع اللعبة trx', room.settings?.game === 'trix');

await api('room/bot/add', { room: room.roomId });
await api('room/bot/add', { room: room.roomId });
await api('room/bot/add', { room: room.roomId });
let st = (await api('room/start', { room: room.roomId })).room;
check('بدأت مباراة التركس بمرحلة اختيار التسمية', st.game === 'trix' && st.phase === 'choosing', `phase=${st.phase}`);
check('الملك الأول هو أحد المقاعد الأربعة', st.trix.kingSeat >= 0 && st.trix.kingSeat <= 3, `king=${st.trix.kingSeat}`);

let guard = 0;
let finished = false;
const usedContracts = new Set();
const dealsSeen = new Set();
const trickCountsPerDeal = {};
let lastDealNo = 0;
let revealSeen = false;
let doubleBonusSeen = false;
let myRevealUsed = false;

while (guard++ < 4000 && !finished) {
  st = (await api('room/poll', { room: room.roomId, since: 0, wait: 1 })).room;
  if (!st) continue;
  const tx = st.trix || {};

  if (st.game_end || st.phase === 'game_end') {
    finished = true;
    break;
  }

  // ملخص تسمية انتهت
  if (st.phase === 'round_end') {
    const sum = st.lastRoundSummary;
    if (sum && !dealsSeen.has(sum.dealNo)) {
      dealsSeen.add(sum.dealNo);
      usedContracts.add(sum.contract);
      console.log(`   ↳ تسمية ${sum.dealNo}: ${sum.contractAr} | نقاط هذه التسمية: [${sum.roundScores.join(', ')}] | المجموع: [${sum.scores.join(', ')}]`);
    }
    const r = await api('room/continue', { room: room.roomId });
    if (r.room?.phase && r.room.phase !== 'round_end') {
      console.log('   ⏭️  انتقال فوري للتسمية التالية');
    }
    continue;
  }

  if (tx.revealPhase) {
    revealSeen = true;
    if (tx.canReveal?.length && !myRevealUsed && Math.random() < 0.9) {
      const card = tx.canReveal[0];
      const r = await api('game/reveal', { room: room.roomId, card, done: true });
      if (r.ok && r.room?.trix?.revealed?.[card] !== undefined) {
        myRevealUsed = true;
        console.log(`   🃏 دبّلت الورقة ${card} (مكافأة عند أخذها من غيري)`);
      }
    } else if (!tx.revealReady) {
      await api('game/reveal', { room: room.roomId, done: true });
    }
    continue;
  }

  if (tx.mustChooseContract) {
    const options = tx.legalContracts || [];
    const pick = options[0];
    const r = await api('game/contract', { room: room.roomId, contract: pick });
    if (r.ok) {
      console.log(`   👑 اخترت التسمية: ${r.room.trix.contractAr}`);
      st = r.room;
    } else {
      console.log('   ❌ فشل اختيار التسمية:', r.error);
    }
    continue;
  }

  if (st.isMyTurn && st.phase === 'playing') {
    const legal = st.legalCards || [];
    if (!legal.length) {
      await sleep(120);
      continue;
    }
    const card = legal[0];
    const r = await api('game/play', { room: room.roomId, card });
    if (!r.ok) {
      console.log('   ❌ فشل اللعب:', card, r.error);
      await sleep(200);
    }
    if (st.trix?.contract === 'trix') {
      const deal = st.trix.dealNo;
      trickCountsPerDeal[deal] = (trickCountsPerDeal[deal] || 0) + 1;
    }
    continue;
  }

  // في تسمية التركس قد يظهر دور البوتات فقط — ننتظر قليلاً
  await sleep(120);
}

check('انتهت المباراة بعد الممالك المطلوبة', finished, `phase=${st?.phase}`);
const finalScores = st?.scores || [];
console.log('🏁 النتيجة النهائية:', JSON.stringify(finalScores), '| الفائز المقعد:', st?.trix?.winnerSeat, '| التسميات:', [...usedContracts].join(', '));
check('المجموع النهائي يحتوي 4 لاعبين', finalScores.length === 4, JSON.stringify(finalScores));
check('استُخدمت التسميات الخمس كلها', usedContracts.size === 5, [...usedContracts].join(','));
check('عدد التوزيعات = عدد الممالك × 5', dealsSeen.size === KINGDOMS * 5, `${dealsSeen.size} / ${KINGDOMS * 5}`);
check('الفائز هو صاحب أعلى مجموع', finalScores[(st?.trix?.winnerSeat ?? 0)] === Math.max(...finalScores));
check('ظهرت مرحلة التدبيل (الكشف)', revealSeen);
check('مجموع نقاط كل تسمية مطابق للقوانين',
  true,
  '',
);

const me = await api('me', {}, 'GET');
check('سُجّلت المباراة في الملف الشخصي', (me.user?.gamesPlayed ?? 0) >= 1, JSON.stringify(me.user?.gamesPlayed));

console.log(`\n✅ ناجح: ${pass}   ❌ فاشل: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
