/**
 * فحص: هل يملك اللاعب أوراقه (١٣) في مرحلة ما قبل القرار؟
 *   - الطرنيب: مرحلة المزايدة (قبل الطلب/التمرير) يجب أن يرى ١٣ ورقة.
 *   - التركس: مرحلة اختيار التسمية يجب أن يرى ١٣ ورقة.
 *   cd tools/dev && node check-visible-hand.mjs
 */
const BASE = process.env.TRIX_API || 'http://127.0.0.1:8095/index.php?r=';
const NO_PRELOAD = process.env.TRIX_NOPRELOAD ? '&__nopreload=1' : '';
let token = '';
async function api(route, body = {}, method = 'POST') {
  const res = await fetch(BASE + route + NO_PRELOAD, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  return res.json();
}
let pass = 0, fail = 0;
const check = (label, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.log('  ❌', label, detail); }
};

async function setup(game, settings) {
  const u = await api('auth/register', { username: game + Date.now().toString(36) + Math.floor(Math.random() * 999), password: '123456', name: 'فاحص ' + game, avatar: '🔎' });
  token = u.token;
  const room = (await api('room/create', { name: 'فحص', settings: { game, ...settings } })).room;
  await api('room/bot/add', { room: room.roomId });
  await api('room/bot/add', { room: room.roomId });
  await api('room/bot/add', { room: room.roomId });
  return (await api('room/start', { room: room.roomId })).room;
}

// ===== الطرنيب: قبل المزايدة =====
console.log('▶️ الطرنيب (مرحلة المزايدة):');
let st = await setup('tarnib', { target: 31 });
let guard = 0;
while (st.phase === 'bidding' && st.isMyTurn === false && guard++ < 40) {
  st = (await api('room/poll', { room: room0(st), since: 0, wait: 1 })).room ?? st;
}
function room0(s) { return s.roomCode; }
check('المرحلة = bidding', st.phase === 'bidding', st.phase);
check('يرى ١٣ ورقة قبل الطلب/التمرير', Array.isArray(st.myHand) && st.myHand.length === 13, `عدد=${st.myHand?.length}`);
console.log('   أوراقي:', (st.myHand || []).join(' '));

// ===== التركس: قبل اختيار التسمية =====
console.log('▶️ التركس (مرحلة اختيار التسمية):');
const t = await setup('trix', { kingdoms: 1, allowDouble: true });
let kindSeen = [];
let cur = t;
for (let i = 0; i < 200 && kindSeen.length < 6; i++) {
  cur = (await api('room/poll', { room: t.roomCode, since: 0, wait: 1 })).room;
  kindSeen.push(cur.phase);
  if (cur.trix?.mustChooseContract || cur.phase === 'choosing') break;
}
check('المرحلة = choosing', cur.phase === 'choosing', cur.phase);
const chooser = cur.trix?.mustChooseContract ? 'أنا الملك' : `الملك مقعد ${cur.trix?.kingSeat}`;
check('الأوراق موزَّعة كاملة (١٣) قبل الاختيار', Array.isArray(cur.myHand) && cur.myHand.length === 13, `${chooser} | عدد=${cur.myHand?.length}`);
console.log('   أوراقي:', (cur.myHand || []).join(' '));
if (cur.trix?.mustChooseContract) {
  check('خيارات التسمية ظاهرة مع الأوراق', (cur.trix.legalContracts || []).length === 5, JSON.stringify(cur.trix.legalContracts));
}

console.log(`\n✅ ناجح: ${pass}   ❌ فاشل: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
