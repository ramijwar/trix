/**
 * اختبار لوحة المدير والبطولات (عبر HTTP على خادم حقيقي)
 *   cd tools/dev && node test-admin.mjs
 *
 * يتحقق من:
 *   - صلاحية المدير (admin_users) وحجب غير المدير.
 *   - سجل اليوم: اللاعبون والطاولات والمباريات.
 *   - البطولات: إنشاء، تسجيل لاعبين، بدء التصفيات، طاولات من ٤،
 *     تحديد المرتبة الأولى والثانية عند نهاية الأدوار.
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

let token = '';
async function api(route, body = {}, method = 'POST') {
  const res = await fetch(BASE + route + NO_PRELOAD, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  return res.json();
}
async function loginAs(username, name) {
  const res = await api('auth/register', { username, password: '123456', name: name ?? username, avatar: '🛡️' });
  if (res.token) return res;
  return api('auth/login', { username, password: '123456' });
}

console.log('▶️ الحسابات:');
const admin = await loginAs('admin', 'مدير اللعبة');
check('تسجيل/دخول حساب admin', Boolean(admin.token), JSON.stringify(admin).slice(0, 120));
token = admin.token;
const me = await api('me', {}, 'GET');
check('حساب admin يُعتبر مديراً', me.user?.isAdmin === true, String(me.user?.isAdmin));

const players = [];
for (let i = 0; i < 8; i++) {
  players.push(await loginAs("bp" + Date.now().toString(36) + i, "لاعب " + (i + 1)));
}
check("٨ لاعبين جاهزون", players.every((p) => p.token));

console.log('▶️ سجل اليوم:');
let today = await api('admin/today', {});
check('admin/today يعمل للمدير', today.ok === true, JSON.stringify(today).slice(0, 120));
check('يحتوي سجل اللاعبين', Array.isArray(today.log?.players), JSON.stringify(today.log?.players?.length));
check('يحتوي سجل الطاولات', Array.isArray(today.log?.rooms));
check('يحتوي سجل المباريات', Array.isArray(today.log?.matches));

// لاعب عادي لا يستطيع الوصول
token = players[0].token;
const denied = await api('admin/today', {});
check('لاعب عادي ممنوع من لوحة المدير', denied.ok === false && denied.code === 'not_admin', JSON.stringify(denied).slice(0, 120));
token = admin.token;

console.log('▶️ إنشاء بطولة:');
const created = await api('admin/tournament/create', {
  tournament: { name: 'بطولة اختبار', game: 'trix', capacity: 8, startAt: Math.floor(Date.now() / 1000) + 60 },
});
check('أُنشئت البطولة', created.ok === true && created.tournament?.code, JSON.stringify(created).slice(0, 140));
const tid = created.tournament?.id;
check("عدد المشاركين المطلوب ٨", created.tournament?.capacity === 8, String(created.tournament?.capacity));

// تسجيل اللاعبين الأربعة
for (const p of players) {
  token = p.token;
  const res = await api('tournament/join', { id: tid });
  if (!res.ok) console.log('   ⚠️ فشل تسجيل لاعب:', res.error);
}
token = admin.token;
let list = await api('admin/tournaments', {});
let t = (list.tournaments || []).find((x) => x.id === tid);
check("٨ مسجّلون", t?.playersCount === 8, String(t?.playersCount));

console.log('▶️ بدء التصفيات:');
const started = await api('admin/tournament/start', { id: tid });
check('انطلقت البطولة', started.ok === true, JSON.stringify(started).slice(0, 120));
list = await api('admin/tournaments', {});
t = (list.tournaments || []).find((x) => x.id === tid);
check('حالة البطولة = التصفيات جارية', t?.status === 'running', String(t?.status));
check("أُنشئت طاولتان (٨ لاعبين)", t?.matches?.length === 2, String(t?.matches?.length));
check('الطاولة فيها ٤ مقاعد', t?.matches?.[0]?.seats?.length === 4, JSON.stringify(t?.matches?.[0]?.seats?.length));
check('لكل مقعد اسم', t?.matches?.[0]?.seats?.every((s) => typeof s.name === 'string' && s.name.length > 0));

// لعب الطاولة حتى النهاية (اللاعبون حقيقيون + بوتات إن نقص)
console.log('▶️ لعب طاولات البطولة حتى النهاية (قد يأخذ دقيقتين)…');
async function playRoom(roomId) {
  let st = null;
  let guard = 0;
  while (guard++ < 3000) {
    let acted = false;
    for (let i = 0; i < players.length; i++) {
      token = players[i].token;
      st = (await api('room/poll', { room: roomId, since: 0, wait: 1 })).room;
      if (!st) continue;
      if (st.phase === 'game_end') return st;
      if (st.phase === 'round_end') {
        await api('room/continue', { room: roomId });
        acted = true;
        continue;
      }
      if (st.trix?.revealPhase) {
        await api('game/reveal', { room: roomId, done: true });
        acted = true;
        continue;
      }
      if (st.trix?.mustChooseContract) {
        await api('game/contract', { room: roomId, contract: st.trix.legalContracts?.[0] });
        acted = true;
        continue;
      }
      if (st.phase === 'bidding' && st.isMyTurn) {
        if (st.legalBids?.length) await api('game/bid', { room: roomId, action: 'bid', value: st.legalBids[0] });
        else await api('game/bid', { room: roomId, action: 'pass' });
        acted = true;
        continue;
      }
      if (st.phase === 'playing' && st.isMyTurn) {
        const card = st.legalCards?.[0];
        if (card) {
          await api('game/play', { room: roomId, card });
          acted = true;
          continue;
        }
      }
    }
    if (!acted) await sleep(100);
  }
  return st;
}

const tablesPerRound = [];
let doneTournament = false;
for (let roundNo = 1; roundNo <= 4 && !doneTournament; roundNo++) {
  token = admin.token;
  let view = await api('admin/tournaments', {});
  let cur = (view.tournaments || []).find((x) => x.id === tid);
  const tables = (cur?.matches || []).filter((m) => m.round === roundNo);
  if (tables.length === 0) break;
  console.log(`   🎯 الدور ${roundNo}: ${tables.length} طاولة`);
  tablesPerRound.push(tables.length);
  for (const table of tables) {
    token = admin.token;
    await api('admin/tournament/advance', { id: tid });
    const stx = await playRoom(table.roomId);
    if (!stx || stx.phase !== 'game_end') console.log('   ⚠️ طاولة لم تنتهِ:', table.roomCode);
  }
  token = admin.token;
  const adv = await api('admin/tournament/advance', { id: tid });
  if (adv.tournament?.status === 'finished') doneTournament = true;
}

token = admin.token;
let st = null;
check('اكتملت كل أدوار التصفيات', doneTournament, JSON.stringify(tablesPerRound));

console.log('▶️ ترقية التصفيات:');
token = admin.token;
const adv = await api('admin/tournament/advance', { id: tid });
check('تم تحديث التصفيات', adv.ok === true, JSON.stringify(adv).slice(0, 140));
list = await api('admin/tournaments', {});
t = (list.tournaments || []).find((x) => x.id === tid);
check('البطولة انتهت بعد الدوري الواحد', t?.status === 'finished', String(t?.status));
check('المرتبة ١ محددة', t?.winners?.[0]?.place === 1, JSON.stringify(t?.winners));
check('المرتبة ٢ محددة', t?.winners?.[1]?.place === 2, JSON.stringify(t?.winners));
console.log(`   🥇 ${t?.winners?.[0]?.name} | 🥈 ${t?.winners?.[1]?.name}`);

// سجل اليوم يجب أن يحتوي الطاولة
token = admin.token;
today = await api('admin/today', {});
const anyTable = (t?.matches || [])[0]?.roomCode;
check('سجل اليوم يحتوي طاولة البطولة', (today.log?.rooms || []).some((r) => r.code === anyTable), String(anyTable));
check('سجل اليوم يحتوي مباراة منتهية', (today.log?.matches || []).length > 0, String((today.log?.matches || []).length));

console.log('\n🀄 بطولة مور:');
token = admin.token;
const morT = await api('admin/tournament/create', {
  tournament: { name: 'بطولة مور', game: 'mor', capacity: 4, startAt: Math.floor(Date.now() / 1000) + 60 },
});
check('أُنشئت بطولة مور', morT.ok === true && morT.tournament?.game === 'mor', JSON.stringify(morT).slice(0, 140));
const morTid = morT.tournament?.id;
for (const p of players) {
  token = p.token;
  await api('tournament/join', { id: morTid });
}
token = admin.token;
let morList = await api('admin/tournaments', {});
let morRow = (morList.tournaments || []).find((x) => x.id === morTid);
check('٤ مسجّلون في بطولة المور', morRow?.playersCount === 4, String(morRow?.playersCount));

const morStart = await api('admin/tournament/start', { id: morTid });
check('انطلقت بطولة المور', morStart.ok === true, JSON.stringify(morStart).slice(0, 140));
morList = await api('admin/tournaments', {});
morRow = (morList.tournaments || []).find((x) => x.id === morTid);
const morMatch = (morRow?.matches || [])[0];
check('أُنشئت طاولة مور واحدة', Boolean(morMatch?.roomCode), JSON.stringify(morMatch?.roomCode));
if (morMatch?.roomCode) {
  // نستخدم رمز أحد اللاعبين المشاركين في الطاولة (المدير ليس مقعداً فيها)
  const seatToken = (players.find((p) => (morMatch.seats || []).some((s) => s.userId === p.id)) || players[0]).token;
  token = seatToken;
  const morState = await api('room/state', { room: morMatch.roomCode });
  const room = morState.room || morState;
  check('طاولة البطولة لعبة مور', room?.settings?.game === 'mor', JSON.stringify(room?.settings?.game));
  check('هدف بطولة المور ٢٠١', Number(room?.target) === 201, String(room?.target));
  check('طريقة الحساب جواكر', (room?.settings?.morMode ?? 'jawaker') === 'jawaker', JSON.stringify(room?.settings?.morMode));
  check('المباراة بدأت (طور اللعب)', ['playing', 'round_end', 'game_end'].includes(String(room?.phase)), String(room?.phase));
  check('حالة المور موجودة', Boolean(room?.mor), JSON.stringify(Object.keys(room?.mor ?? {})).slice(0, 100));
}

console.log(`\n✅ ناجح: ${pass}   ❌ فاشل: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
