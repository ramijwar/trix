/**
 * اختبار شامل لواجهة الخادم: تسجيل → إنشاء غرفة → بوتات → بدء → لعب جولات كاملة
 *   cd tools/dev && node test-api.mjs
 */
const BASE = process.env.TRIX_API || 'http://127.0.0.1:8095/index.php?r=';
let token = '';

async function api(route, body = {}, opts = {}) {
  const res = await fetch(BASE + route, {
    method: opts.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: opts.method === 'GET' ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok && !opts.allowFail) {
    throw new Error(`${route} فشل: ${json.error || json.code}`);
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const username = 'player' + Math.random().toString(36).slice(2, 8);
  const reg = await api('auth/register', { username, password: '123456', name: 'لاعب تجريبي' });
  token = reg.token;
  console.log('✅ تسجيل مستخدم:', reg.user.name, '| عملات:', reg.user.coins);

  const room = (await api('room/create', { name: 'طاولة اختبار', settings: { target: 31, allowDouble: true } })).room;
  console.log('✅ إنشاء غرفة:', room.roomCode, '| الحالة:', room.phase);

  let r = (await api('room/bot/add', { room: room.roomId })).room;
  r = (await api('room/bot/add', { room: room.roomId })).room;
  r = (await api('room/bot/add', { room: room.roomId })).room;
  console.log('✅ إضافة بوتات:', r.seats.filter(Boolean).map((s) => s.name).join(', '));

  r = (await api('room/start', { room: room.roomId })).room;
  console.log('✅ بدء المباراة | المرحلة:', r.phase, '| أوراقي:', r.myHand.length);

  let guard = 0;
  let lastRound = -1;
  let played = 0;
  while (guard++ < 4000) {
    const state = (await api('room/poll', { room: room.roomId, since: 0, wait: 1 })).room;

    if (state.phase === 'game_end') {
      console.log('🏆 انتهت المباراة | النتيجة:', state.scores, '| الفريق الفائز:', state.winnerTeam);
      break;
    }
    if (state.phase === 'round_end') {
      if (state.round !== lastRound) {
        lastRound = state.round;
        const s = state.lastRoundSummary;
        console.log(`📊 جولة ${s.round}: طلب ${s.bid} من المقعد ${s.bidder} | ناجح: ${s.made} | الفرق: ${s.delta} | النقاط: ${s.scores}`);
      }
      await api('room/continue', { room: room.roomId });
      await sleep(120);
      continue;
    }
    if (state.mustChooseTrump) {
      const suits = ['S', 'H', 'D', 'C'];
      const pick = suits[Math.floor(Math.random() * 4)];
      await api('game/trump', { room: room.roomId, suit: pick });
      console.log(`🎴 اخترت الطرنيب: ${pick}`);
      continue;
    }
    if (state.isMyTurn && state.phase === 'bidding') {
      // استراتيجية بسيطة: اطلب 7 إن لم يوجد طلب، وإلا مرّر
      if (state.bid.value === null) {
        await api('game/bid', { room: room.roomId, action: 'bid', value: 7 });
      } else {
        await api('game/bid', { room: room.roomId, action: 'pass' });
      }
      continue;
    }
    if (state.isMyTurn && state.phase === 'playing' && state.legalCards.length) {
      const card = state.legalCards[Math.floor(Math.random() * state.legalCards.length)];
      await api('game/play', { room: room.roomId, card });
      played++;
      if (played % 13 === 0) {
        console.log(`   ↳ لعبت ${played} ورقة | أكلات الفريقين: ${state.tricksWon}`);
      }
      continue;
    }
    // انتظار البوتات
    await sleep(80);
  }

  const finalState = (await api('room/state', { room: room.roomId })).room;
  console.log('✅ حالة نهائية:', finalState.phase, '| النقاط:', finalState.scores, '| الجولة:', finalState.round);
  const me = await api('me', {}, { method: 'GET' });
  console.log('✅ إحصاءاتي:', JSON.stringify(me.user).slice(0, 200));
  const board = await api('lobby/leaderboard', {}, { method: 'GET' });
  console.log('✅ المتصدرون:', board.players.length, 'لاعب');
  const lobby = await api('lobby', {}, { method: 'GET' });
  console.log('✅ الردهة: غرف =', lobby.rooms.length, '| متصلون =', lobby.stats.online);
  if (guard >= 4000) {
    console.log('⚠️ توقف الاختبار عند الحد الأقصى للتكرارات');
  }
}

main().catch((err) => {
  console.error('❌ خطأ:', err.message);
  process.exit(1);
});
