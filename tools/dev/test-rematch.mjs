/**
 * اختبار ميزة "مباراة جديدة" (Rematch) بعد نهاية المباراة
 *   cd tools/dev && node test-rematch.mjs
 * يلعب مباراة كاملة حتى نهاية الهدف، ثم يطلب من صاحب الغرفة بدء مباراة جديدة
 * ويتأكد أن النقاط صفرت والمرحلة عادت للمزاد.
 */
const BASE = process.env.TRIX_API || 'http://127.0.0.1:8095/index.php?r=';
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

const u = await api('auth/register', { username: 'rematch' + Date.now().toString(36), password: '123456', name: 'فاحص الإعادة' });
token = u.token;
const room = (await api('room/create', { name: 'طاولة الإعادة', settings: { target: 31, turnTime: 30, bidTime: 30 } })).room;
await api('room/bot/add', { room: room.roomId });
await api('room/bot/add', { room: room.roomId });
await api('room/bot/add', { room: room.roomId });
const start = (await api('room/start', { room: room.roomId })).room;
console.log('▶️ بدأت المباراة | المرحلة:', start.phase, '| الهدف:', start.target);

let round = 0;
let guard = 0;
let finished = false;
while (guard++ < 3000 && !finished) {
  const st = (await api('room/poll', { room: room.roomId, since: 0, wait: 1 })).room;
  if (!st) continue;
  if (st.round > round && st.lastRoundSummary) {
    round = st.round;
    console.log(`   جولة ${st.round - 1} انتهت | النقاط: ${st.scores[0]}-${st.scores[1]}`);
  }
  if (st.phase === 'game_end') {
    finished = true;
    console.log(`🏆 نهاية المباراة | ${st.scores[0]}-${st.scores[1]} | الفائز: ${st.winnerTeam}`);
    break;
  }
  if (st.mustChooseTrump) {
    await api('game/trump', { room: room.roomId, suit: 'S' });
    continue;
  }
  if (st.isMyTurn && st.phase === 'bidding') {
    await api('game/bid', st.bid.value === null ? { room: room.roomId, action: 'bid', value: 7 } : { room: room.roomId, action: 'pass' });
    continue;
  }
  if (st.isMyTurn && st.phase === 'playing' && st.legalCards?.length) {
    await api('game/play', { room: room.roomId, card: st.legalCards[0] });
    continue;
  }
  await sleep(150);
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

check('انتهت المباراة ووصل أحد الفريقين للهدف', finished);

const rematch = await api('room/continue', { room: room.roomId });
const r = rematch.room;
check('room/continue في نهاية المباراة يبدأ مباراة جديدة', rematch.ok === true && r?.phase === 'bidding', JSON.stringify(rematch).slice(0, 140));
check('النقاط عادت إلى صفر', Array.isArray(r?.scores) && r.scores[0] === 0 && r.scores[1] === 0, JSON.stringify(r?.scores));
check('الجولة عادت إلى 1 وأوراق جديدة وُزّعت', r?.round === 1 && r?.myHand?.length === 13, `round=${r?.round} hand=${r?.myHand?.length}`);
check('لا يوجد فائز سابق في المباراة الجديدة', !r?.winnerTeam);
check('المقاعد الأربعة ما زالت مشغولة', r?.seats?.filter(Boolean).length === 4);

const guestTry = await api('room/continue', { room: room.roomId });
check('الطلب الثاني لا يكسر شيئاً', guestTry.ok === true);

await api('room/leave', { room: room.roomId });
const me = await api('me', {}, 'GET');
check('تسجيل نتائج المباراة في الملف الشخصي', me.user?.gamesPlayed >= 1, JSON.stringify(me.user).slice(0, 100));

console.log(`\n✅ ناجح: ${pass}   ❌ فاشل: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
