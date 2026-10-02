const BASE = 'http://127.0.0.1:8095/index.php?r=';
let token = '';
async function api(route, body = {}, method = 'POST') {
  const res = await fetch(BASE + route, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  return res.json();
}
const u = await api('auth/register', { username: 'dbg' + Date.now().toString(36), password: '123456', name: 'فحص' });
token = u.token;
const room = (await api('room/create', { name: 'فحص', settings: { turnTime: 30, bidTime: 30 } })).room;
await api('room/bot/add', { room: room.roomId });
await api('room/bot/add', { room: room.roomId });
await api('room/bot/add', { room: room.roomId });
const st = (await api('room/start', { room: room.roomId })).room;
console.log('start phase', st.phase, 'mySeat', st.mySeat, 'turn', st.turn, 'isMyTurn', st.isMyTurn);
for (let i = 0; i < 25; i++) {
  const r = (await api('room/poll', { room: room.roomId, since: 0, wait: 1 })).room;
  console.log(
    i,
    '| phase', r.phase,
    '| turn', r.turn,
    '| myTurn', r.isMyTurn,
    '| legal', r.legalCards.length,
    '| bid', JSON.stringify(r.bid.value),
    '| passed', JSON.stringify(r.bid.passed),
    '| trump', r.trump,
    '| hands', JSON.stringify(r.handCounts),
    '| mustTrump', r.mustChooseTrump,
  );
  if (r.isMyTurn && r.phase === 'bidding') {
    if (r.mustChooseTrump) await api('game/trump', { room: room.roomId, suit: 'S' });
    else if (r.bid.value === null) await api('game/bid', { room: room.roomId, action: 'bid', value: 7 });
    else await api('game/bid', { room: room.roomId, action: 'pass' });
  } else if (r.isMyTurn && r.phase === 'playing' && r.legalCards.length) {
    await api('game/play', { room: room.roomId, card: r.legalCards[0] });
  }
  await new Promise((r2) => setTimeout(r2, 400));
}
