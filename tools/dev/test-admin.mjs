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
/** يحوّل معاملات GET إلى رابط (تُقرأ من $_GET في الخادم) */
const withQuery = (route, body, method) => {
  if (method !== 'GET' || !body || Object.keys(body).length === 0) return route;
  const qs = new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString();
  // BASE ينتهي بـ index.php?r= لذا نلصق دائماً بـ & حتى لا تتشوّه قيمة r
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
  const res = await fetch(BASE + withQuery(route, body, method) + NO_PRELOAD, {
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
check(
  'سجل المباريات يبيّن نوع اللعبة',
  (today.log?.matches || []).every((m) => ['tarnib', 'trix'].includes(String(m.game ?? ''))),
  JSON.stringify((today.log?.matches || []).slice(0, 2).map((m) => m.game)),
);

/* ============================ شاشة البطولة للمستخدم ============================ */
console.log('\n🏟️ شاشة البطولة (شاشة الانتظار):');
token = players[0].token;
const tview = await api('tournament/view', { id: tid }, 'GET');
check('tournament/view يفتح شاشة البطولة', tview.ok === true && tview.tournament?.id === tid, JSON.stringify(tview).slice(0, 140));
check('الشاشة تُظهر المنظّم', (tview.tournament?.organizer?.name ?? '').length > 0, JSON.stringify(tview.tournament?.organizer));
check('الشاشة تُظهر المشاركين', (tview.tournament?.players?.length ?? 0) >= 4, String(tview.tournament?.players?.length));
check('الشاشة تُظهر الفائزين بعد النهاية', (tview.tournament?.winners?.length ?? 0) >= 1, JSON.stringify(tview.tournament?.winners));

/* ============================ تعديل بطولة وإلغاؤها وحذفها ============================ */
console.log('\n✏️ تعديل/إلغاء/حذف البطولة:');
token = admin.token;
const editT = await api('admin/tournament/update', {
  id: tid,
  tournament: { name: 'بطولة معدّلة', capacity: 4, startAt: Math.floor(Date.now() / 1000) + 900 },
});
check('تعديل البطولة ينجح', editT.ok === true && editT.tournament?.name === 'بطولة معدّلة', JSON.stringify(editT).slice(0, 140));
check('عدد المشاركين عُدّل', editT.tournament?.capacity === 4, String(editT.tournament?.capacity));

// بطولة مؤقتة للتجربة: إلغاء ثم حذف
const tempT = await api('admin/tournament/create', {
  tournament: { name: 'بطولة للإلغاء', game: 'tarnib', capacity: 4, startAt: Math.floor(Date.now() / 1000) + 600 },
});
const tempId = tempT.tournament?.id;
for (const p of players.slice(0, 4)) {
  token = p.token;
  await api('tournament/join', { id: tempId });
}
token = players[0].token;
let mineList = await api('tournaments', {}, 'GET');
check('البطولة تظهر للاعب بعد التسجيل', (mineList.mine || []).some((x) => x.id === tempId), JSON.stringify((mineList.mine || []).map((x) => x.id)));
token = admin.token;
const cancel = await api('admin/tournament/status', { id: tempId, status: 'cancelled' });
check('إلغاء البطولة ينجح', cancel.ok === true, JSON.stringify(cancel).slice(0, 120));
token = players[0].token;
mineList = await api('tournaments', {}, 'GET');
check('البطولة الملغاة تختفي من عند اللاعبين', !(mineList.mine || []).some((x) => x.id === tempId));
check('البطولة الملغاة لا تظهر في القائمة العامة', !(mineList.tournaments || []).some((x) => x.id === tempId));
token = admin.token;
const del = await api('admin/tournament/delete', { id: tempId });
check('حذف البطولة ينجح', del.ok === true, JSON.stringify(del).slice(0, 120));
list = await api('admin/tournaments', {});
check('البطولة المحذوفة غير موجودة في اللوحة', !(list.tournaments || []).some((x) => x.id === tempId));
const goneView = await (async () => {
  token = players[0].token;
  return api('tournament/view', { id: tempId }, 'GET');
})();
check('شاشة البطولة المحذوفة تُرجع خطأ واضحاً', goneView.ok === false && goneView.code === 'not_found', JSON.stringify(goneView).slice(0, 120));

/* ============================ إدارة المستخدمين ============================ */
console.log('\n👤 تعديل المستخدمين وحذفهم:');
token = admin.token;
const target = players[7];
const upd = await api('admin/user/update', {
  id: target.user.id,
  name: 'اسم معدّل',
  coins: 1234,
  xp: 900,
  is_admin: false,
  banned: false,
});
check('admin/user/update ينجح', upd.ok === true, JSON.stringify(upd).slice(0, 120));
const usersList = await api('admin/users', { q: 'اسم معدّل' }, 'GET');
const updated = (usersList.users || []).find((u) => u.id === target.user.id);
check('الاسم تعدّل فعلاً', updated?.name === 'اسم معدّل', JSON.stringify(updated?.name));
check('العملات تعدّلت', updated?.coins === 1234, String(updated?.coins));
check('الخبرة رفعت المستوى', Number(updated?.level) > 1, `level=${updated?.level}`);
const banIt = await api('admin/user/action', { id: target.user.id, action: 'ban' });
check('إيقاف المستخدم ينجح', banIt.ok === true);
const bannedList = await api('admin/users', { q: 'اسم معدّل' }, 'GET');
check('المستخدم موقوف في القائمة', (bannedList.users || []).find((u) => u.id === target.user.id)?.banned === true);
await api('admin/user/action', { id: target.user.id, action: 'unban' });
const newPass = await api('admin/user/action', { id: target.user.id, action: 'password', password: 'newpass123' });
check('تعيين كلمة مرور جديدة ينجح', newPass.ok === true, JSON.stringify(newPass).slice(0, 120));
const shortPass = await api('admin/user/action', { id: target.user.id, action: 'password', password: '12' });
check('كلمة المرور القصيرة مرفوضة', shortPass.ok === false && shortPass.code === 'weak_password', JSON.stringify(shortPass).slice(0, 120));

// حذف مستخدم تجريبي
const victim = await loginAs('del' + Date.now().toString(36), 'للحذف');
const removeUser = await api('admin/user/action', { id: victim.user.id, action: 'delete' });
check('حذف المستخدم ينجح', removeUser.ok === true, JSON.stringify(removeUser).slice(0, 120));
const afterDelete = await api('admin/users', { q: 'للحذف' }, 'GET');
check('المستخدم المحذوف لم يبقَ في القائمة', !(afterDelete.users || []).some((u) => u.id === victim.user.id));

/* ============================ سجل الطاولات الكامل ============================ */
console.log('\n📜 سجل الطاولات الكامل:');
token = admin.token;
const hist = await api('admin/history', { limit: 30 }, 'GET');
check('admin/history يعمل', hist.ok === true && Array.isArray(hist.matches), JSON.stringify(hist).slice(0, 140));
check('السجل يعرض إجمالي المباريات', Number(hist.totals?.matches) > 0, String(hist.totals?.matches));
check('السجل يعرض إجمالي الطاولات', Number(hist.totals?.rooms) > 0, String(hist.totals?.rooms));
const firstMatch = (hist.matches || [])[0];
check('كل مباراة فيها النتيجة', firstMatch && Number.isFinite(firstMatch.scoreA) && Number.isFinite(firstMatch.scoreB));
check('كل مباراة فيها الفائز بالاسم', Array.isArray(firstMatch?.winners) && firstMatch.winners.filter(Boolean).length > 0, JSON.stringify(firstMatch?.winners));
check('كل مباراة فيها نوع اللعبة', ['tarnib', 'trix'].includes(String(firstMatch?.game)), String(firstMatch?.game));
check('السجل يعرض كل الطاولات السابقة', (hist.rooms || []).length > 0, String((hist.rooms || []).length));
check('طاولة منتهية تحمل نتيجتها', (hist.rooms || []).some((r) => r.finished && Number.isFinite(r.scoreA)), JSON.stringify((hist.rooms || []).slice(0, 2)));
const filtered = await api('admin/history', { limit: 10, game: 'trix' }, 'GET');
check('تصفية السجل بنوع اللعبة تعمل', (filtered.matches || []).every((m) => m.game === 'trix'), JSON.stringify((filtered.matches || []).map((m) => m.game).slice(0, 5)));
const deniedHist = await (async () => {
  token = players[0].token;
  return api('admin/history', {}, 'GET');
})();
check('السجل ممنوع على اللاعب العادي', deniedHist.ok === false && deniedHist.code === 'not_admin');

console.log(`\n✅ ناجح: ${pass}   ❌ فاشل: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
