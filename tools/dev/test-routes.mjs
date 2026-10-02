/**
 * اختبار تغطية شامل لجميع مسارات الـ API التي تستخدمها الواجهة
 *   cd tools/dev && node test-routes.mjs
 * يفحص كل مسار على حدة ويتأكد من نجاحه أو من رجوعه بخطأ متوقّع.
 */
const BASE = process.env.TRIX_API || 'http://127.0.0.1:8095/index.php?r=';

let pass = 0;
let fail = 0;
const failures = [];

async function call(route, body = {}, { token = '', method = 'POST', expectOk = true } = {}) {
  const res = await fetch(BASE + route, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  let json;
  try {
    json = await res.json();
  } catch {
    json = { ok: false, error: 'رد غير JSON', code: 'bad' };
  }
  return { status: res.status, json };
}

function check(label, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  ❌ ${label} ${detail}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/* ============================ الاختبارات ============================ */

section('🔌 الأساسيات');
{
  const h = await call('health', {}, { method: 'GET' });
  check('health يعمل و SQLite متاح', h.json.ok === true && h.json.sqlite === 'yes', JSON.stringify(h.json).slice(0, 120));
  const nf = await call('no/such/route', {}, { expectOk: false });
  check('المسار غير الموجود يعيد 404', nf.status === 404, `status=${nf.status}`);
}

section('👤 الحسابات');
const user1 = 'route1_' + Math.random().toString(36).slice(2, 8);
let token = '';
let roomId_global = '';
{
  const r = await call('auth/register', { username: user1, password: '123456', name: 'فاحص المسارات', avatar: '🦊' });
  check('auth/register', r.json.ok === true && !!r.json.token, JSON.stringify(r.json).slice(0, 120));
  token = r.json.token || '';
  check('بيانات المستخدم الجديد صحيحة', r.json.user?.coins === 500 && r.json.user?.level === 1);

  const dup = await call('auth/register', { username: user1, password: '123456' });
  check('منع تكرار اسم المستخدم (409)', dup.status === 409 && dup.json.code === 'username_taken', `status=${dup.status}`);

  const bad = await call('auth/login', { username: user1, password: 'wrong-pass' });
  check('كلمة مرور خاطئة مرفوضة', bad.json.ok === false, JSON.stringify(bad.json).slice(0, 80));

  const lg = await call('auth/login', { username: user1, password: '123456' });
  check('auth/login يعمل', lg.json.ok === true && !!lg.json.token);

  const g = await call('auth/guest', { device: 'test-device' });
  check('auth/guest يمنح جلسة زائر', g.json.ok === true && g.json.user?.isGuest === true);
  const guestLogout = await call('auth/logout', {}, { token: g.json.token });
  check('auth/logout يعمل', guestLogout.json.ok === true);

  const me = await call('me', {}, { token, method: 'GET' });
  check('me يعيد الملف العام', me.json.ok === true && me.json.user?.username === user1);
}

section('🏠 الردهة والملف الشخصي والمتجر');
{
  const lb = await call('lobby', { limit: 20 }, { token, method: 'GET' });
  check('lobby يعيد الغرف والإحصاءات', lb.json.ok === true && Array.isArray(lb.json.rooms) && !!lb.json.stats);

  const board = await call('leaderboard', { limit: 20 }, { token, method: 'GET' });
  check('leaderboard يعيد قائمة اللاعبين', board.json.ok === true && Array.isArray(board.json.players));

  const prof = await call('profile', {}, { token, method: 'GET' });
  check('profile يعيد الإحصاءات والتاريخ', prof.json.ok === true && !!prof.json.profile && Array.isArray(prof.json.history));

  const upd = await call('profile/update', { name: 'فاحص محدَّث', avatar: '🐺' }, { token });
  check('profile/update يحدّث الاسم والصورة', upd.json.ok === true && upd.json.user?.name === 'فاحص محدَّث', JSON.stringify(upd.json).slice(0, 100));

  const shop = await call('shop', {}, { token, method: 'GET' });
  check('shop يعيد العناصر والمحفظة', shop.json.ok === true && shop.json.items?.length > 0);

  const buy = await call('shop/buy', { item: 'card_red' }, { token });
  check('shop/buy لعنصر مجاني', buy.json.ok === true, JSON.stringify(buy.json).slice(0, 120));

  const buy2 = await call('shop/buy', { item: 'card_blue' }, { token });
  check('shop/buy لعنصر مدفوع يكفي رصيده', buy2.json.ok === true, JSON.stringify(buy2.json).slice(0, 120));

  const equip = await call('shop/equip', { type: 'cardBack', value: 'blue' }, { token });
  check('shop/equip يجهّز العنصر', equip.json.ok === true && equip.json.user?.cardBack === 'blue', JSON.stringify(equip.json).slice(0, 120));

  const badEquip = await call('shop/equip', { type: 'nope', value: 'x' }, { token });
  check('shop/equip يرفض النوع غير المعروف', badEquip.json.ok === false);

  const costly = await call('shop/buy', { item: 'card_gold' }, { token });
  check('shop/buy يرفض عند نقص الرصيد (402)', costly.status === 402 && costly.json.code === 'not_enough_coins', `status=${costly.status}`);

  const daily = await call('profile/daily', {}, { token });
  check('profile/daily يمنح المكافأة', daily.json.ok === true && daily.json.result?.granted === true);
}

section('🃏 الغرف والمقاعد والإعدادات');
{
  // غرفة للفحص فقط (بدون لعبة) — لا نستخدم quick هنا لأنها تنقل اللاعب من غرفته
  const c = await call('room/create', { name: 'طاولة الفحص', settings: { target: 41, allowDouble: true, turnTime: 15, bidTime: 15 } }, { token });
  check('room/create ينشئ غرفة بإعدادات مخصصة', c.json.ok === true && !!c.json.room?.roomId);
  const roomId = c.json.room?.roomId || '';
  check('الإعدادات المخصصة مطبَّقة', c.json.room?.target === 41 && c.json.room?.settings?.allowDouble === true, JSON.stringify(c.json.room?.settings));

  const st = await call('room/state', { room: roomId }, { token });
  check('room/state يعيد حالة الغرفة', st.json.ok === true && st.json.room?.roomCode?.length === 5);

  const b1 = await call('room/bot/add', { room: roomId }, { token });
  const b2 = await call('room/bot/add', { room: roomId }, { token });
  const b3 = await call('room/bot/add', { room: roomId }, { token });
  check('room/bot/add يضيف بوتات حتى تكتمل الطاولة', b3.json.ok === true && b3.json.room?.seats?.filter(Boolean).length === 4, JSON.stringify(b3.json).slice(0, 120));
  void b1; void b2;

  const b4 = await call('room/bot/add', { room: roomId }, { token });
  check('room/bot/add يرفض طاولة ممتلئة', b4.json.ok === false, JSON.stringify(b4.json).slice(0, 100));

  const rm = await call('room/bot/remove', { room: roomId, seat: 3 }, { token });
  check('room/bot/remove يزيل البوت', rm.json.ok === true && rm.json.room?.seats?.[3] === null);
  const addBack = await call('room/bot/add', { room: roomId, seat: 3 }, { token });
  check('إعادة إضافة البوت لنفس المقعد', addBack.json.ok === true && !!addBack.json.room?.seats?.[3]);

  const ready = await call('room/ready', { room: roomId, ready: true }, { token });
  check('room/ready يعمل', ready.json.ok === true && ready.json.room?.seats?.[ready.json.room.mySeat]?.ready === true);

  const settings = await call('room/settings', { room: roomId, settings: { target: 61, turnTime: 30, bidTime: 30, allowDouble: false } }, { token });
  check('room/settings يحدّث الإعدادات', settings.json.ok === true && settings.json.room?.target === 61 && settings.json.room?.settings?.allowDouble === false);

  const chat = await call('room/chat', { room: roomId, text: 'أهلاً بالجميع 👋', emoji: '👋' }, { token });
  check('room/chat يرسل رسالة', chat.json.ok === true && chat.json.room?.chat?.length > 0);

  const rename = await call('room/rename', { room: roomId, name: 'طاولة معاد تسميتها' }, { token });
  check('room/rename يعمل لصاحب الغرفة', rename.json.ok === true && rename.json.room?.roomName === 'طاولة معاد تسميتها');

  const seatChange = await call('room/seat', { room: roomId, seat: (c.json.room?.mySeat === 0 ? 1 : 0) }, { token });
  const movedOk = seatChange.json.ok === true && seatChange.json.room?.isSpectator === false;
  check('room/seat يبدّل المقعد أو يرفض بإخبار السبب', movedOk || ['seat_taken', 'occupied'].includes(seatChange.json.code), JSON.stringify(seatChange.json).slice(0, 100));

  const arrange = await call('room/arrange', { room: roomId, order: [0, 1, 2, 3] }, { token });
  check('room/arrange يعيد الترتيب', arrange.json.ok === true, JSON.stringify(arrange.json).slice(0, 100));

  const swap = await call('room/swap', { room: roomId, seat: 1 }, { token });
  check('room/swap يتعامل مع البوتات بأمان', swap.json.ok === true || swap.json.code === 'is_bot', JSON.stringify(swap.json).slice(0, 100));

  const leaveThis = await call('room/leave', { room: roomId }, { token });
  check('room/leave يخرج من الطاولة', leaveThis.json.ok === true);
}

section('🃏 اللعب في طاولة مستقلة');
{
  const c = await call('room/create', { name: 'طاولة اللعب', settings: { target: 31, turnTime: 30, bidTime: 30 } }, { token });
  const roomId = c.json.room?.roomId || '';
  await call('room/bot/add', { room: roomId }, { token });
  await call('room/bot/add', { room: roomId }, { token });
  await call('room/bot/add', { room: roomId }, { token });

  const start = await call('room/start', { room: roomId }, { token });
  check('room/start يبدأ المباراة', start.json.ok === true && start.json.room?.phase === 'bidding', JSON.stringify(start.json).slice(0, 120));
  check('تم توزيع 13 ورقة', start.json.room?.myHand?.length === 13);

  let played = 0;
  let tricksResolved = 0;
  let sawTrump = false;
  let sawRoundEnd = false;
  let illegalRejected = false;
  for (let i = 0; i < 1200; i++) {
    const st = (await call('room/poll', { room: roomId, since: 0, wait: 1 }, { token })).json.room;
    if (!st) break;
    if (st.tricksWon) tricksResolved = Math.max(tricksResolved, st.tricksWon[0] + st.tricksWon[1]);
    if (st.phase === 'round_end' || st.phase === 'game_end') {
      sawRoundEnd = true;
      if (st.lastRoundSummary) {
        check('ملخص الجولة يحتوي بيانات الحساب', typeof st.lastRoundSummary.delta?.[0] === 'number' && st.lastRoundSummary.bid >= 7);
      }
      break;
    }
    if (st.trump) sawTrump = true; // قد يختارها بوت إن فاز بالمزاد
    if (st.mustChooseTrump) {
      const t = await call('game/trump', { room: roomId, suit: 'H' }, { token });
      check('game/trump يعمل (اختيار اللاعب)', t.json.ok === true && t.json.room?.trump === 'H', JSON.stringify(t.json).slice(0, 100));
      sawTrump = true;
      continue;
    }
    if (st.isMyTurn && st.phase === 'bidding') {
      const r = st.bid.value === null
        ? await call('game/bid', { room: roomId, action: 'bid', value: 7 }, { token })
        : await call('game/bid', { room: roomId, action: 'pass' }, { token });
      if (!r.json.ok) check('game/bid مقبول', false, JSON.stringify(r.json).slice(0, 120));
      continue;
    }
    if (st.isMyTurn && st.phase === 'playing' && st.legalCards?.length) {
      const illegal = (st.myHand || []).find((cc) => !st.legalCards.includes(cc));
      if (illegal && !illegalRejected) {
        const bad = await call('game/play', { room: roomId, card: illegal }, { token });
        illegalRejected = bad.json.ok === false;
        check('game/play يرفض ورقة غير قانونية', illegalRejected, JSON.stringify(bad.json).slice(0, 100));
      }
      const r = await call('game/play', { room: roomId, card: st.legalCards[0] }, { token });
      if (!r.json.ok) check('game/play مقبول', false, JSON.stringify(r.json).slice(0, 120));
      played++;
      continue;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  check('لعبت أوراقاً فعلية', played > 0, `played=${played}`);
  check('اكتملت أكلة واحدة على الأقل', tricksResolved >= 1, `tricks=${tricksResolved}`);
  check('مرّت جولة كاملة بنجاح', sawRoundEnd);
  check('تم اختيار الطرنيب في الجولة', sawTrump);
  const afterRound = (await call('room/state', { room: roomId }, { token })).json.room;
  check('النقاط تحدّثت بعد الجولة', afterRound?.scores?.some((s) => s !== 0) || afterRound?.round >= 1, JSON.stringify(afterRound?.scores));

  const cont = await call('room/continue', { room: roomId }, { token });
  check('room/continue يبدأ الجولة التالية', cont.json.ok === true && (cont.json.room?.phase === 'bidding' || cont.json.room?.phase === 'playing'), JSON.stringify(cont.json.room?.phase));

  const leave2 = await call('room/leave', { room: roomId }, { token });
  check('room/leave بعد اللعب (تحويل لبوت)', leave2.json.ok === true);
  roomId_global = roomId;

  const quick = await call('room/quick', { settings: { target: 31 } }, { token });
  check('room/quick ينشئ/ينضم لغرفة سريعة', quick.json.ok === true && !!quick.json.room?.roomId);
  const leftQuick = await call('room/leave', { room: quick.json.room?.roomId }, { token });
  check('room/leave للغرفة السريعة', leftQuick.json.ok === true);
}

section('🧹 التنظيف');
{
  const leave = await call('room/leave', { room: roomId_global }, { token });
  check('room/leave ينهي المشاركة', leave.json.ok === true);
  const out = await call('auth/logout', {}, { token });
  check('auth/logout بعد نهاية الاختبار', out.json.ok === true);
}

console.log(`\n${'='.repeat(48)}`);
console.log(`✅ ناجح: ${pass}   ❌ فاشل: ${fail}`);
if (fail) {
  console.log('الاختبارات الفاشلة:');
  failures.forEach((f) => console.log('  -', f));
}
process.exit(fail === 0 ? 0 : 1);
