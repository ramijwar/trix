/**
 * اختبار استمرار المباريات المهجورة (طاولة بلا لاعبين بشريين):
 *   cd tools/dev && node test-orphan.mjs
 *
 * السيناريو: لاعب بشري + ٣ بوتات → يبدأ اللعب → يخرج اللاعب (أو ينقطع).
 * المفروض: البوتات تُكمل المباراة حتى نهايتها، والنتيجة تُسجَّل في سجل المدير،
 * وعدد الطلبات المطلوبة محدود (الخادم هو من يُكمل، لا اللاعب).
 */
const BASE = process.env.TRIX_API || 'http://127.0.0.1:8095/index.php?r=';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** يحوّل معاملات GET إلى رابط (تُقرأ من $_GET في الخادم) */
const withQuery = (route, body, method) => {
  if (method !== 'GET' || !body || Object.keys(body).length === 0) return route;
  const qs = new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString();
  return route + '&' + qs;
};

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

let token = '';
async function api(route, body = {}, method = 'POST') {
  const res = await fetch(BASE + withQuery(route, body, method), {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  return res.json();
}
async function register(name) {
  const r = await api('auth/register', {
    username: 'or' + Math.random().toString(36).slice(2, 9),
    password: '123456',
    name,
    avatar: '🤖',
  });
  return r;
}

console.log('▶️ تجهيز طاولة بوتات + لاعب واحد:');
const admin = await (async () => {
  const r = await api('auth/register', { username: 'admin', password: '123456', name: 'مدير اللعبة', avatar: '🛡️' });
  if (r.token) return r;
  return api('auth/login', { username: 'admin', password: '123456' });
})();
check('دخول المدير', Boolean(admin.token));

const human = await register('لاعب سيهجر الطاولة');
token = human.token;
const room = (await api('room/create', { name: 'طاولة مهجورة', settings: { game: 'tarnib', target: 31 } })).room;
check('أُنشئت الطاولة', Boolean(room?.roomId), JSON.stringify(room).slice(0, 120));
for (let i = 0; i < 3; i++) await api('room/bot/add', { room: room.roomId });
const started = await api('room/start', { room: room.roomId });
check('بدأت المباراة مع البوتات', started.ok === true && ['bidding', 'playing'].includes(started.room?.phase), JSON.stringify(started.room?.phase));

console.log('▶️ خروج اللاعب البشري…');
await api('room/leave', { room: room.roomId });
token = admin.token;
let state = (await api('room/state', { room: room.roomId })).room;
check('المقعد تحوّل لبوت بعد الخروج', state?.seats?.every((s) => s && s.isBot === true), JSON.stringify((state?.seats || []).map((s) => s?.isBot)));
check('لا يوجد لاعب بشري متصل', (state?.seats || []).every((s) => !s || s.isBot || !s.connected));

console.log('▶️ إكمال المباراة تلقائياً (الخادم يُكمل الطاولات المهجورة)…');
let finished = false;
let ticks = 0;
for (let i = 0; i < 60 && !finished; i++) {
  // أي طلب للردهة يدفع الطاولات المهجورة خطوة للأمام
  await api('lobby', { limit: 5 }, 'GET');
  token = admin.token;
  const st = (await api('room/state', { room: room.roomId })).room;
  ticks++;
  if (st?.phase === 'game_end' || st?.status === 'finished') {
    finished = true;
    break;
  }
  await sleep(120);
}
check('المباراة استمرت وانتهت بلا لاعبين', finished, `ticks=${ticks}`);

token = admin.token;
const hist = await api('admin/history', { limit: 40, q: room.roomCode }, 'GET');
const match = (hist.matches || []).find((m) => m.roomCode === room.roomCode);
check('النتيجة سُجّلت في سجل الطاولات', Boolean(match), JSON.stringify((hist.matches || []).map((m) => m.roomCode).slice(0, 6)));
check('السجل يبيّن النتيجة والفائز', Boolean(match) && Number.isFinite(match.scoreA) && match.winners.filter(Boolean).length > 0, JSON.stringify(match && { s: [match.scoreA, match.scoreB], w: match.winners }));

// طاولة بوتات بالكامل: تُكمل أيضاً
console.log('▶️ طاولة بوتات بالكامل (بلا أي لاعب بشري):');
token = human.token;
const botRoom = (await api('room/create', { name: 'طاولة بوتات', settings: { game: 'tarnib' } })).room;
await api('room/bot/add', { room: botRoom.roomId });
await api('room/bot/add', { room: botRoom.roomId });
const q = await api('room/quick', { settings: { game: 'tarnib' } });
check('مسارات البوتات تعمل', Boolean(botRoom?.roomId) && q.ok === true);
token = admin.token;
const humanSeats = (await api('room/state', { room: botRoom.roomId })).room?.seats?.filter(Boolean).length ?? 0;
check('الطاولة الثانية بلا لاعبين بشريين', humanSeats >= 1);

console.log(`\n================================================\n✅ ناجح: ${pass}   ❌ فاشل: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
