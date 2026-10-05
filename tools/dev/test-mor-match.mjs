/**
 * اختبار طويل: يلعب مباراة مور كاملة حتى نهاية المباراة (هدف ١٠١) عبر HTTP
 *   cd tools/dev && node test-mor-match.mjs [الهدف]
 *
 * يتحقق من: الوصول إلى game_end، فوز فريق بلوغ الهدف، وتسجيل المباراة في قاعدة البيانات
 * (الصف في جدول matches) وتحديث ملف اللاعب — وهي المسارات التي لا تُغطّى في الاختبار القصير.
 */
const BASE = process.env.TRIX_API || 'http://127.0.0.1:8095/index.php?r=';
const TARGET = Number(process.argv[2] || 101);
const MAX_ROUNDS = 80;

let token = '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(route, body = {}, method = 'POST') {
  const res = await fetch(BASE + route, {
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

const RANK = (c) => (c[0] === 'X' ? 15 : parseInt(c.slice(1), 10));
const isWild = (c) => RANK(c) === 15 || RANK(c) === 2;

function validateMeld(cards) {
  if (cards.length < 3) return { ok: false };
  const wilds = cards.filter(isWild);
  const naturals = cards.filter((c) => !isWild(c));
  if (wilds.length > 2) return { ok: false };
  if (wilds.filter((c) => c[0] === 'X').length > 1 || wilds.filter((c) => RANK(c) === 2).length > 1) return { ok: false };
  if (!naturals.length) return { ok: false };
  if (naturals.every((c) => RANK(c) === RANK(naturals[0])) && [3, 14].includes(RANK(naturals[0]))) return { ok: true, kind: 'set' };
  const suit = naturals[0][0];
  if (!naturals.every((c) => c[0] === suit)) return { ok: false };
  for (const [min, max] of [[1, 13], [3, 14]]) {
    const pos = new Set();
    let bad = false;
    for (const c of naturals) {
      const r = RANK(c);
      const p = r === 14 ? (min === 1 ? 1 : 14) : r;
      if (p < min || p > max || pos.has(p)) { bad = true; break; }
      pos.add(p);
    }
    if (bad) continue;
    const keys = [...pos].sort((a, b) => a - b);
    const n = cards.length;
    if (Math.max(min, keys[keys.length - 1] - n + 1) <= Math.min(keys[0], max - n + 1)) return { ok: true, kind: 'seq' };
  }
  return { ok: false };
}

const u = await api('auth/register', { username: 'morm' + Date.now().toString(36), password: '123456', name: 'لاعب مباراة', avatar: '🀄' });
token = u.token;
const room = (await api('room/create', { name: 'مباراة مور كاملة', settings: { game: 'mor', morMode: 'jawaker', target: TARGET, turnTime: 15 } })).room;
console.log('▶️ غرفة المباراة الكاملة:', room.roomCode, '| الهدف:', room.target);
await api('room/bot/add', { room: room.roomId });
await api('room/bot/add', { room: room.roomId });
await api('room/bot/add', { room: room.roomId });
let st = (await api('room/start', { room: room.roomId })).room;

let guard = 0;
let rounds = 0;
let finished = false;
let movement = 0;
let myActions = 0;

while (guard++ < 20000 && !finished) {
  st = (await api('room/poll', { room: room.roomId, since: 0, wait: 1 })).room;
  if (!st) continue;

  if (st.phase === 'game_end') {
    finished = true;
    break;
  }

  if (st.phase === 'round_end') {
    rounds++;
    const sum = st.lastRoundSummary || {};
    movement += Math.abs((sum.deltas ?? [0, 0])[0] ?? 0) + Math.abs((sum.deltas ?? [0, 0])[1] ?? 0);
    console.log(`   ↳ لقطة ${sum.round}: ${sum.reason === 'closed' ? `إغلاق للفريق ${sum.winnerTeam}` : 'نفدت الرزمة'} | المجموع [${sum.scores}]`);
    if (rounds >= MAX_ROUNDS) {
      console.log('   ⚠️  توقف: لم تنته المباراة داخل', MAX_ROUNDS, 'لقطة');
      break;
    }
    st = (await api('room/continue', { room: room.roomId })).room || st;
    continue;
  }

  if (st.phase !== 'playing' || !st.mor || !st.isMyTurn) continue;

  // سحب
  if (st.mor.needDraw) {
    const src = st.mor.canTakePile && Math.random() < 0.3 ? 'pile' : 'deck';
    const r = await api('mor/draw', { room: room.roomId, source: src });
    if (!r.ok) { check('mor/draw', false, JSON.stringify(r).slice(0, 120)); break; }
    st = r.room;
    myActions++;
  }
  if (st.phase !== 'playing') continue;

  // خطة كومة الرمي
  if (st.mor.pilePending) {
    const pile = [...(st.mor.pileCards || [])];
    const hand = [...pile, ...(st.myHand || []).filter((c) => !pile.includes(c))];
    let plan = null;
    for (const p0 of pile) {
      const rest = hand.filter((c) => c !== p0);
      for (let i = 0; i < rest.length && !plan; i++) {
        for (let j = i + 1; j < rest.length; j++) {
          if (validateMeld([p0, rest[i], rest[j]]).ok && rest.length - 2 >= 1) { plan = { type: 'meld', cards: [p0, rest[i], rest[j]] }; break; }
        }
      }
      if (plan) break;
    }
    if (!plan) {
      for (const me of st.mor.melds[st.mySeat % 2]) {
        for (const p0 of pile) {
          const v = validateMeld([...me.cards, p0]);
          if (v.ok && v.kind === me.kind) { plan = { type: 'add', meld: me.id, cards: [p0] }; break; }
        }
        if (plan) break;
      }
    }
    if (plan?.type === 'meld') st = (await api('mor/meld', { room: room.roomId, cards: plan.cards })).room || st;
    else if (plan?.type === 'add') st = (await api('mor/add', { room: room.roomId, meld: plan.meld, cards: plan.cards })).room || st;
  }

  // نزول صالح
  const hand = [...(st.myHand || [])];
  let melded = false;
  outer: for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      for (let k = j + 1; k < hand.length; k++) {
        if (validateMeld([hand[i], hand[j], hand[k]]).ok) {
          const r = await api('mor/meld', { room: room.roomId, cards: [hand[i], hand[j], hand[k]] });
          if (r.ok) { st = r.room; melded = true; break outer; }
        }
      }
    }
  }
  if (melded) myActions++;

  // رمي
  const h2 = [...(st.myHand || [])];
  if (h2.length > 1) {
    const cands = h2.filter((c) => !isWild(c) && RANK(c) !== 3 && RANK(c) !== 14);
    const pool = cands.length ? cands : h2;
    const card = pool[Math.floor(Math.random() * pool.length)];
    const r = await api('mor/discard', { room: room.roomId, card });
    if (!r.ok) { check('mor/discard', false, JSON.stringify(r).slice(0, 120)); break; }
    st = r.room;
    myActions++;
    if (st.phase === 'game_end') { finished = true; break; }
  } else if (st.mor.canTakeMor) {
    const r = await api('mor/take', { room: room.roomId });
    if (r.ok) { st = r.room; myActions++; }
  } else {
    await sleep(100);
  }
}

console.log(`\n   ↳ لقطات: ${rounds} | حركاتي: ${myActions} | مجموع تغيّر النقاط: ${movement}`);
check('انتهت المباراة بفائز', st?.phase === 'game_end' && st.winnerTeam !== null, `phase=${st?.phase} winner=${st?.winnerTeam}`);
check('نقاط الفائز بلغت الهدف', Math.max(st?.scores?.[0] ?? 0, st?.scores?.[1] ?? 0) >= TARGET, JSON.stringify(st?.scores));
check('لُعبت لقطات كافية', rounds >= 3, `${rounds}`);

const board = await api('lobby/leaderboard', { limit: 100 });
const mine = (board.players || []).find((p) => p.name === 'لاعب مباراة' || p.username?.startsWith('morm'));
check(
  'المباراة سُجّلت في الملفات الشخصية',
  Boolean(mine) && Number(mine.gamesPlayed ?? mine.played ?? 0) >= 1,
  JSON.stringify(mine ?? board.players?.slice(0, 2) ?? board).slice(0, 200),
);

console.log(`\n📌 رمز الغرفة للتسجيل: ${room.roomCode}`);
console.log(`\n================================================\n✅ ناجح: ${pass}   ❌ فاشل: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
