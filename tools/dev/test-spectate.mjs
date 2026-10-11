/**
 * اختبار المشاهدين وتحسينات الشبكة (عبر HTTP على خادم حقيقي)
 *   cd tools/dev && node test-spectate.mjs
 *
 * يتحقق من:
 *   - دخول أي مستخدم كـ«مشاهد» لغرفة مكتملة أثناء اللعب (بلا مقعد).
 *   - رؤية المشاهد للطاولة كاملة بلا أي أوراق خاصة (myHand فارغة، لا أزرار).
 *   - منع المشاهد من تنفيذ حركات اللعب.
 *   - قدرة المشاهد على الدردشة وظهورها للاعبين بعلامة مشاهد.
 *   - ظهور عدد المشاهدين لدى اللاعبين في الطاولة وفي قائمة الطاولات.
 *   - الرد الصغير عند عدم وجود جديد (unchanged) وردّ الحالة عند حدوث تغيير.
 *   - أن المشاهد لا يرفع رقم النسخة (حضوره لا يزعج اللاعبين).
 */
const BASE = process.env.TRIX_API || 'http://127.0.0.1:8095/index.php?r=';
const NO_PRELOAD = process.env.TRIX_NOPRELOAD ? '&__nopreload=1' : '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function api(route, body = {}, token = '', method = 'POST') {
  const res = await fetch(BASE + route + NO_PRELOAD, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  return res.json();
}

const register = async (name) => {
  const r = await api('auth/register', { username: 'sp' + Math.random().toString(36).slice(2, 9), password: '123456', name, avatar: '🙂' });
  return r.token;
};

/* ============================ التجهيز ============================ */
const host = await register('صاحب الطاولة');
const guest = await register('مشاهد فضولي');
const guest2 = await register('مشاهد ثانٍ');

const room = (await api('room/create', { name: 'طاولة للمشاهدة', settings: { game: 'tarnib', target: 31 } }, host)).room;
await api('room/bot/add', { room: room.roomId }, host);
await api('room/bot/add', { room: room.roomId }, host);
await api('room/bot/add', { room: room.roomId }, host);
const started = (await api('room/start', { room: room.roomId }, host)).room;
console.log('▶️ غرفة:', room.roomCode, '| الطور:', started.phase, '| نوع اللعبة:', started.settings?.game);
check('بدأت المباراة (طور اللعب)', started.phase === 'playing' || started.phase === 'bidding');

/* ============================ الدخول كمشاهد ============================ */
const watched = await api('room/watch', { room: room.roomCode }, guest);
check('room/watch ينجح لأي مستخدم', watched.ok === true, JSON.stringify(watched).slice(0, 140));
const gv = watched.room || {};
check('المشاهد بلا مقعد', gv.mySeat === -1 || gv.isSpectator === true, `seat=${gv.mySeat} spec=${gv.isSpectator}`);
check('وضع المشاهدة مفعّل', gv.isSpectator === true, String(gv.isSpectator));
check('المشاهد لا يرى أوراقاً', Array.isArray(gv.myHand) && gv.myHand.length === 0, JSON.stringify(gv.myHand).slice(0, 60));
check('المشاهد يرى الطاولة كاملة (٤ مقاعد)', Array.isArray(gv.seats) && gv.seats.filter(Boolean).length === 4);
check('المشاهد لا يستطيع اللعب (لا أوراق قانونية)', (gv.legalCards || []).length === 0 && gv.isMyTurn === false);
check('المشاهد يرى الطور الحقيقي للعبة', gv.phase === started.phase || gv.phase === 'playing', `${gv.phase}`);

const hostView = (await api('room/state', { room: room.roomId }, host)).room;
check('اللاعب يرى عدد المشاهدين = ١', hostView?.spectators?.count === 1, JSON.stringify(hostView?.spectators));
check('اسم المشاهد يظهر للاعبين', hostView?.spectators?.list?.[0]?.name === 'مشاهد فضولي', JSON.stringify(hostView?.spectators?.list));
check('اللاعب نفسه ليس مشاهداً', hostView?.isSpectator === false);

/* ============================ منع الحركات ============================ */
const illegalPlay = await api('game/play', { room: room.roomId, card: 'H5' }, guest);
check('المشاهد لا يستطيع اللعب (game/play مرفوض)', illegalPlay.ok === false, JSON.stringify(illegalPlay).slice(0, 120));
const illegalDraw = await api('room/draw', { room: room.roomId }, guest);
check('المشاهد لا يستطيع الحركات الخاصة', illegalDraw.ok === false, JSON.stringify(illegalDraw).slice(0, 120));

/* ============================ الدردشة ============================ */
const chat = await api('room/chat', { room: room.roomId, text: 'متابع من الخارج 👋' }, guest);
check('المشاهد يستطيع الدردشة', chat.ok === true, JSON.stringify(chat).slice(0, 140));
const afterChat = (await api('room/state', { room: room.roomId }, host)).room;
const specMsg = (afterChat?.chat || []).find((m) => (m.text || '').includes('متابع من الخارج'));
check('رسالة المشاهد تصل للاعبين', Boolean(specMsg), JSON.stringify((afterChat?.chat || []).slice(-2)));
check('الرسالة معلّمة بأنها من مشاهد', specMsg?.spectator === true && specMsg?.seat === null, JSON.stringify(specMsg).slice(0, 140));
check('اسم المشاهد على الرسالة', specMsg?.name === 'مشاهد فضولي', String(specMsg?.name));

/* ============================ عدد المشاهدين ============================ */
await api('room/watch', { room: room.roomCode }, guest2);
const hostView2 = (await api('room/state', { room: room.roomId }, host)).room;
check('العدد يتحدّث لمشاهدَين', hostView2?.spectators?.count === 2, JSON.stringify(hostView2?.spectators?.count));
const roomList = await api('lobby', { limit: 40 }, host, 'GET');
const row = (roomList.rooms || []).find((r) => r.code === room.roomCode);
check('قائمة الطاولات تُظهر عدد المشاهدين', row?.spectators === 2, JSON.stringify(row && { code: row.code, spec: row.spectators }));
check('عدد اللاعبين لا يشمل المشاهدين', row?.players === 4, String(row?.players));

/* ============================ الرد الصغير (توفير البيانات) ============================ */
// طاولة هادئة (بلا بوتات) لقياس سلوك الاستعلام بلا جديد
const quiet = (await api('room/create', { name: 'هدوء الشبكة', settings: { game: 'tarnib' } }, host)).room;
await api('room/watch', { room: quiet.roomCode }, guest);
await sleep(900);
const q1 = (await api('room/state', { room: quiet.roomId }, guest)).room;
const idle = await api('room/poll', { room: quiet.roomId, since: q1.version, wait: 2 }, guest);
const idleSize = JSON.stringify(idle).length;
check('الاستعلام بلا جديد يردّ unchanged', idle.ok === true && idle.unchanged === true && idle.room === null, JSON.stringify(idle).slice(0, 140));
check('حجم الرد الصغير أقل من ٢٠٠ حرف', idleSize < 200, `size=${idleSize}`);
check('الرد الصغير يحمل رقم النسخة والوقت', Number(idle.version) >= 0 && Number(idle.serverTime) > 0, JSON.stringify(idle).slice(0, 120));

// تغيير حقيقي (رسالة دردشة) يجب أن يعيد الحالة كاملة عند الاستعلام
await api('room/chat', { room: quiet.roomId, text: 'تنبيه المشاهدين' }, host);
const woke = await api('room/poll', { room: quiet.roomId, since: q1.version, wait: 4 }, guest);
check('التغيير يعيد الحالة الكاملة فوراً', woke.ok === true && woke.room && woke.room.version > q1.version, JSON.stringify({ v: woke.room?.version, since: q1.version }).slice(0, 120));
check('الحالة الكاملة تُرسل عند التغيير', Array.isArray(woke.room?.chat) && woke.room.chat.some((m) => (m.text || '').includes('تنبيه المشاهدين')));
const idle2 = await api('room/poll', { room: quiet.roomId, since: woke.room.version, wait: 2 }, guest);
check('ثم يعود للرد الصغير', idle2.unchanged === true && idle2.room === null, JSON.stringify(idle2).slice(0, 120));

// «تحديث» اليدوي يعيد الحالة كاملة دائماً (زر التحديث في الطاولة)
const manual = await api('room/state', { room: quiet.roomId }, guest);
check('زر التحديث (room/state) يردّ الحالة كاملة', manual.ok === true && manual.room?.version === idle2.version, JSON.stringify({ v: manual.room?.version, i: idle2.version }));

/* ============================ الخروج وعدّاد المشاهدين ============================ */
await api('room/leave', { room: room.roomId }, guest2);
const hostView3 = (await api('room/state', { room: room.roomId }, host)).room;
check('خروج مشاهد ينقص العدد', hostView3?.spectators?.count === 1, JSON.stringify(hostView3?.spectators?.count));

// المشاهد لا يمكنه الجلوس أثناء اللعب
const sit = await api('room/seat', { room: room.roomId, seat: 0 }, guest);
check('المشاهد لا يزحزح لاعباً أثناء اللعب', sit.ok === false, JSON.stringify(sit).slice(0, 120));

/* ============================ غرفة انتظار: الجلوس في مقعد فارغ ============================ */
const waitingRoom = (await api('room/create', { name: 'طاولة انتظار', settings: { game: 'trix' } }, host)).room;
const w1 = (await api('room/watch', { room: waitingRoom.roomCode }, guest)).room;
check('مشاهدة غرفة في الانتظار تعمل', w1?.isSpectator === true, JSON.stringify(w1?.isSpectator));
const wSeat = await api('room/seat', { room: waitingRoom.roomId, seat: 1 }, guest);
check('المشاهد يستطيع الجلوس في مقعد فارغ قبل البدء', wSeat.ok === true && wSeat.room?.mySeat === 1, JSON.stringify(wSeat).slice(0, 140));
check('بعد الجلوس لم يبقَ مشاهداً', wSeat.room?.isSpectator === false, String(wSeat.room?.isSpectator));
await api('room/leave', { room: waitingRoom.roomId }, guest);

/* ============================ المشاهدة في المور ============================ */
const morRoom = (await api('room/create', { name: 'مور للمشاهدة', settings: { game: 'mor', morMode: 'jawaker', target: 101 } }, host)).room;
await api('room/bot/add', { room: morRoom.roomId }, host);
await api('room/bot/add', { room: morRoom.roomId }, host);
await api('room/bot/add', { room: morRoom.roomId }, host);
await api('room/start', { room: morRoom.roomId }, host);
const morWatch = (await api('room/watch', { room: morRoom.roomCode }, guest)).room;
check('مشاهدة المور تعمل', morWatch?.isSpectator === true && morWatch?.phase === 'playing', `${morWatch?.phase}`);
check('المشاهد لا يرى أوراق المور', (morWatch?.myHand || []).length === 0 && (morWatch?.mor?.pileCards || []).length === 0);
check('أزرار المور معطّلة للمشاهد', !morWatch?.mor?.canTakePile && !morWatch?.mor?.canTakeMor && !morWatch?.mor?.canCloseNow);
check('المشاهد يرى نزولات الفريقين', Array.isArray(morWatch?.mor?.melds?.[0]) && Array.isArray(morWatch?.mor?.melds?.[1]));

/* ============================ الطاولات المحمية بكلمة مرور ============================ */
const privateRoom = (await api('room/create', { name: 'خاصة', settings: { game: 'tarnib' }, password: '1234', isPrivate: true }, host)).room;
const badWatch = await api('room/watch', { room: privateRoom.roomCode, password: '0000' }, guest);
check('المشاهدة تُحترم بكلمة المرور', badWatch.ok === false, JSON.stringify(badWatch).slice(0, 120));

await api('room/leave', { room: room.roomId }, host);
await api('room/leave', { room: room.roomId }, guest);

console.log(`\n================================================\n✅ ناجح: ${pass}   ❌ فاشل: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
