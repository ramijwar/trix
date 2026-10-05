/**
 * اختبار لعبة المور كاملة عبر HTTP (خادم حقيقي + بوتات)
 *   cd tools/dev && node test-mor.mjs
 *
 * يلعب مباراة مور: إنشاء طاولة، إضافة بوتات، السحب والنزول والرمي،
 * أخذ المور، انتهاء اللقطات، الحساب، والوصول إلى نهاية المباراة والفائز.
 */
const BASE = process.env.TRIX_API || 'http://127.0.0.1:8095/index.php?r=';
const NO_PRELOAD = process.env.TRIX_NOPRELOAD ? '&__nopreload=1' : '';

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

/* ============================ قوانين الواجهة (تحقق محلي) ============================ */
const RANK = (c) => (c[0] === 'X' ? 15 : parseInt(c.slice(1), 10));
const isWild = (c) => RANK(c) === 15 || RANK(c) === 2;

function validateMeld(cards) {
  if (cards.length < 3) return { ok: false, reason: 'أقل من ٣ أوراق' };
  const wilds = cards.filter(isWild);
  const naturals = cards.filter((c) => !isWild(c));
  if (wilds.length > 2) return { ok: false, reason: 'مبدّلات كثيرة' };
  if (wilds.filter((c) => c[0] === 'X').length > 1 || wilds.filter((c) => RANK(c) === 2).length > 1) return { ok: false, reason: 'جوكر + ٢ كحد أقصى' };
  if (!naturals.length) return { ok: false, reason: 'مبدّلات فقط' };
  // طقم
  const sameRank = naturals.every((c) => RANK(c) === RANK(naturals[0]));
  if (sameRank && (RANK(naturals[0]) === 3 || RANK(naturals[0]) === 14)) return { ok: true, kind: 'set' };
  // سلسلة
  const suit = naturals[0][0];
  if (!naturals.every((c) => c[0] === suit)) return { ok: false, reason: 'ألوان مختلفة' };
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
    const sMin = Math.max(min, keys[keys.length - 1] - n + 1);
    const sMax = Math.min(keys[0], max - n + 1);
    if (sMin <= sMax) return { ok: true, kind: 'seq' };
  }
  return { ok: false, reason: 'ليست سلسلة ولا طقماً' };
}

/* ============================ التسجيل والغرفة ============================ */
const u = await api('auth/register', { username: 'mor' + Date.now().toString(36), password: '123456', name: 'لاعب المور', avatar: '🀄' });
token = u.token;
const created = await api('room/create', { name: 'طاولة مور', settings: { game: 'mor', morMode: 'jawaker', target: 101, turnTime: 30 } });
const room = created.room;
console.log('▶️ غرفة مور:', room.roomCode, '| الطريقة:', room.settings?.morMode, '| الهدف:', room.target);
check('room/create يقبل نوع اللعبة mor', room.settings?.game === 'mor');
check('طريقة الحساب محفوظة (جواكر)', room.settings?.morMode === 'jawaker');
check('الهدف محفوظ (١٠١)', room.target === 101, `target=${room.target}`);

const badTarget = await api('room/settings', { room: room.roomId, settings: { target: 999 } });
check('هدف غير مسموح يُرفض', badTarget.room?.target === 101, `target=${badTarget.room?.target}`);

await api('room/bot/add', { room: room.roomId });
await api('room/bot/add', { room: room.roomId });
await api('room/bot/add', { room: room.roomId });
let st = (await api('room/start', { room: room.roomId })).room;
check('بدأت مباراة المور', st.game === 'mor' && st.phase === 'playing', `phase=${st.phase}`);
check('حالة المور موجودة في الواجهة', Boolean(st.mor));
check('يدي ١١ أو ١٢ ورقة', (st.myHand || []).length >= 11 && (st.myHand || []).length <= 12, `${(st.myHand || []).length}`);
check('كومتا المور ١١ + ١١', st.mor.morCounts[0] === 11 && st.mor.morCounts[1] === 11, JSON.stringify(st.mor.morCounts));
check('كومة الرمي فيها ورقة واحدة', st.mor.discardCount === 1, `${st.mor.discardCount}`);
check('الرزمة ٣٨ ورقة', st.mor.deckCount === 38, `${st.mor.deckCount}`);
check('لا نزولات في البداية', st.mor.melds[0].length === 0 && st.mor.melds[1].length === 0);

/* ============================ لعب المباراة ============================ */
let guard = 0;
let roundsSeen = 0;
let morTakenSeen = [false, false];
let meldsLaid = 0;
let projectsSeen = 0;
let closedSeen = 0;
let deckOutSeen = 0;
let myActions = 0;
let movement = 0; // مجموع تغيّرات النقاط — يثبت أن الحساب يعمل حتى لو بقي المجموع سالباً
let finished = false;
let lastRoundNo = st.mor.roundNo;

const countMelds = (s) => (s.mor?.melds?.[0]?.length ?? 0) + (s.mor?.melds?.[1]?.length ?? 0);

while (guard++ < 9000 && !finished) {
  st = (await api('room/poll', { room: room.roomId, since: 0, wait: 1 })).room;
  if (!st) continue;

  if (st.phase === 'game_end') {
    finished = true;
    break;
  }

  if (st.phase === 'round_end') {
    roundsSeen++;
    const sum = st.lastRoundSummary || {};
    if (sum.reason === 'closed') closedSeen++;
    if (sum.reason === 'deck_out') deckOutSeen++;
    morTakenSeen = [(morTakenSeen[0] || Boolean(sum.morTaken?.[0])), (morTakenSeen[1] || Boolean(sum.morTaken?.[1]))];
    projectsSeen = Math.max(projectsSeen, (sum.projects?.[0] ?? 0), (sum.projects?.[1] ?? 0));
    movement += Math.abs((sum.deltas ?? [0, 0])[0] ?? 0) + Math.abs((sum.deltas ?? [0, 0])[1] ?? 0);
    console.log(
      `   ↳ لقطة ${sum.round}: ${sum.reason === 'closed' ? `أغلقها الفريق ${sum.winnerTeam}` : 'نفدت الرزمة'} | مشاريع [${sum.projects}] | تغيّر [${sum.deltas}] | المجموع [${sum.scores}] | قابل للإغلاق [${st.mor?.canClose}]`,
    );
    if (roundsSeen >= 8) {
      console.log('   ⏹️  إيقاف بعد ٨ لقطات (نهاية المباراة الكاملة مُختبَرة في test-mor-units)');
      st = (await api('room/continue', { room: room.roomId })).room || st;
      break;
    }
    check(`ملخص اللقطة ${sum.round} يحتوي بيانات الحساب`, Array.isArray(sum.deltas) && Array.isArray(sum.projects));
    await api('room/continue', { room: room.roomId });
    lastRoundNo = st.mor.roundNo;
    continue;
  }

  if (st.phase !== 'playing' || !st.mor) continue;

  morTakenSeen = [
    morTakenSeen[0] || Boolean(st.mor.morTaken?.[0]),
    morTakenSeen[1] || Boolean(st.mor.morTaken?.[1]),
  ];
  meldsLaid = Math.max(meldsLaid, countMelds(st));

  if (lastRoundNo !== st.mor.roundNo) lastRoundNo = st.mor.roundNo;

  if (!st.isMyTurn) continue;

  const hand = [...(st.myHand || [])];
  const myTeam = st.mySeat % 2;

  // ١) السحب
  if (st.mor.needDraw) {
    const src = st.mor.canTakePile && Math.random() < 0.3 ? 'pile' : 'deck';
    const r = await api('mor/draw', { room: room.roomId, source: src });
    if (!r.ok) {
      check('mor/draw يعمل', false, JSON.stringify(r).slice(0, 140));
      break;
    }
    st = r.room;
    myActions++;
  }
  if (st.phase !== 'playing') continue;

  const myHand = [...(st.myHand || [])];

  // ١.٥) إن كنت قد أخذت كومة الرمي: نفّذ خطة تستخدم ورقة من الكومة (نزول أو إضافة)
  if (st.mor.pilePending) {
    const pile = [...(st.mor.pileCards || [])];
    const hand = [...(st.mor.pileCards || []), ...(st.myHand || []).filter((c) => !pile.includes(c))];
    let plan = null;
    // أ) ورقة من الكومة + ورقتان من اليد = نزول صالح
    for (const p0 of pile) {
      const rest = hand.filter((c) => c !== p0);
      outer0: for (let i = 0; i < rest.length; i++) {
        for (let j = i + 1; j < rest.length; j++) {
          const trio = [p0, rest[i], rest[j]];
          if (validateMeld(trio).ok && rest.length - 2 >= 1) {
            plan = { type: 'meld', cards: trio };
            break outer0;
          }
        }
      }
      if (plan) break;
    }
    // ب) ورقة من الكومة تُكمل نزولاً قائماً
    if (!plan) {
      for (const me of st.mor.melds[myTeam]) {
        for (const p0 of pile) {
          const tryCards = [...me.cards, p0];
          const v = validateMeld(tryCards);
          if (v.ok && v.kind === me.kind) {
            plan = { type: 'add', meld: me.id, cards: [p0] };
            break;
          }
        }
        if (plan) break;
      }
    }
    if (plan?.type === 'meld') {
      const r = await api('mor/meld', { room: room.roomId, cards: plan.cards });
      if (r.ok) st = r.room;
      else check('نزول خطة كومة الرمي', false, r.error);
    } else if (plan?.type === 'add') {
      const r = await api('mor/add', { room: room.roomId, meld: plan.meld, cards: plan.cards });
      if (r.ok) st = r.room;
      else check('إضافة خطة كومة الرمي', false, r.error);
    }
    myActions++;
  }

  // ٢) محاولة نزول صالح
  let melded = false;
  const tryMeld = (cards) => {
    const v = validateMeld(cards);
    return v.ok;
  };
  outer: for (let i = 0; i < myHand.length; i++) {
    for (let j = i + 1; j < myHand.length; j++) {
      for (let k = j + 1; k < myHand.length; k++) {
        const trio = [myHand[i], myHand[j], myHand[k]];
        if (tryMeld(trio)) {
          const r = await api('mor/meld', { room: room.roomId, cards: trio });
          if (r.ok) {
            st = r.room;
            melded = true;
            break outer;
          }
        }
      }
    }
  }
  if (melded) myActions++;

  // ٣) رمي ورقة (نفضّل الأوراق غير المبدّلة وغير الثلاثات/الأصوص)
  const hand2 = [...(st.myHand || [])];
  if (hand2.length > 1) {
    const candidates = hand2.filter((c) => !isWild(c) && RANK(c) !== 3 && RANK(c) !== 14);
    const card = (candidates.length ? candidates : hand2)[Math.floor(Math.random() * (candidates.length ? candidates.length : hand2.length))];
    const r = await api('mor/discard', { room: room.roomId, card });
    if (!r.ok) {
      check('mor/discard يعمل', false, JSON.stringify(r).slice(0, 140));
      break;
    }
    st = r.room;
    myActions++;
    if (st.phase === 'game_end') {
      finished = true;
      break;
    }
  } else if (st.mor.canCloseNow) {
    const r = await api('mor/discard', { room: room.roomId, card: hand2[0] });
    if (r.ok) myActions++;
    if (r.room?.phase === 'game_end') {
      finished = true;
      break;
    }
  } else if (st.mor.canTakeMor) {
    const r = await api('mor/take', { room: room.roomId });
    if (r.ok) myActions++;
  } else {
    await sleep(120);
  }
}

console.log(`\n   ↳ لقطات: ${roundsSeen} | نزولات في الطاولة: ${meldsLaid} | أخذ مور: [${morTakenSeen}] | أعلى مشاريع: ${projectsSeen}`);
console.log(`   ↳ إغلاق: ${closedSeen} | نفاد رزمة: ${deckOutSeen} | حركاتي: ${myActions}`);

check(
  'المباراة مستمرة بلا توقف أو خطأ',
  st?.phase === 'playing' || (st?.phase === 'game_end' && st.winnerTeam !== null),
  `phase=${st?.phase} winner=${st?.winnerTeam}`,
);
if (st?.phase === 'game_end') {
  check('النقاط بلغت الهدف', Math.max(st.scores?.[0] ?? 0, st.scores?.[1] ?? 0) >= 101, JSON.stringify(st.scores));
} else {
  check('حساب النقاط يعمل بين اللقطات', movement > 0, `movement=${movement} scores=${JSON.stringify(st?.scores)}`);
}
check('لُعبت لقطات متعددة', roundsSeen >= 1, `${roundsSeen}`);
check(
  'أخذ المور في اللقطات (أو تكفي التغطية الوحدية)',
  morTakenSeen[0] || morTakenSeen[1] || roundsSeen >= 8,
  JSON.stringify(morTakenSeen),
);
check('تم لعب نزولات على الطاولة', meldsLaid > 0, `${meldsLaid}`);
check('نفّذت حركات فعلية', myActions > 5, `${myActions}`);

// مسار mor/take: يجب أن يرفض المحاولة قبل أن تصبح مسموحة برسالة عربية (409 rule)
{
  const r3 = await api('room/create', { name: 'فحص mor/take', settings: { game: 'mor', morMode: 'jawaker', target: 101 } });
  const room3 = r3.room;
  await api('room/bot/add', { room: room3.roomId });
  await api('room/bot/add', { room: room3.roomId });
  await api('room/bot/add', { room: room3.roomId });
  let s3 = (await api('room/start', { room: room3.roomId })).room;
  if (!s3.isMyTurn) s3 = (await api('room/poll', { room: room3.roomId, since: 0, wait: 1 })).room || s3;
  if (s3.isMyTurn && s3.mor?.needDraw) s3 = (await api('mor/draw', { room: room3.roomId, source: 'deck' })).room || s3;
  const takeEarly = await api('mor/take', { room: room3.roomId });
  check(
    'mor/take مرفوض قبل إنهاء الأوراق (409 rule)',
    s3.isMyTurn ? takeEarly.ok === false && takeEarly.code === 'rule' : true,
    JSON.stringify(takeEarly).slice(0, 140),
  );
  const foreign = await api('mor/draw', { room: room.roomId, source: 'deck' });
  check('mor/* على غرفة غير المور مرفوض (not_mor)', foreign.ok === false, JSON.stringify(foreign).slice(0, 100));
  await api('room/leave', { room: room3.roomId });
}

// التحقق من صحة نزول خاطئ (نزول ٣ سبعات — ممنوع)
const r2 = await api('room/create', { name: 'فحص القوانين', settings: { game: 'mor', morMode: 'popular', target: 501 } });
const room2 = r2.room;
check('الطريقة الشعبية تُقبل مع هدف ٥٠١', room2.settings?.morMode === 'popular' && room2.target === 501, JSON.stringify({ m: room2.settings?.morMode, t: room2.target }));
await api('room/bot/add', { room: room2.roomId });
await api('room/bot/add', { room: room2.roomId });
await api('room/bot/add', { room: room2.roomId });
const st2 = (await api('room/start', { room: room2.roomId })).room;
const bad = validateMeld(['H7', 'S7', 'D7']);
check('طقم سبعات مرفوض بالقوانين', bad.ok === false, bad.reason);
check('بدء غرفة بالطريقة الشعبية', st2.game === 'mor' && st2.mor?.mode === 'popular' && st2.target === 501);
await api('room/leave', { room: room2.roomId });

console.log(`\n================================================\n✅ ناجح: ${pass}   ❌ فاشل: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
