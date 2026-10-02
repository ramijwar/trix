/**
 * أنواع البيانات الأساسية للعبة الطرنيب
 * ------------------------------------------------------------------
 * يتم تمثيل الورقة كنص مختصر لتسهيل الإرسال عبر الشبكة:
 *   suit  : C (كبة/سبيت) | D (ديناري) | H (كوبا/قلوب) | S (بستوني/سبيد)
 *   rank  : 2..10 ثم J=11, Q=12, K=13, A=14
 *   code  : "SA" = آس البستوني، "H10" = عشرة الكوبا، "C2" = ٢ الكبة
 * الترتيب: A > K > Q > J > 10 > ... > 2 داخل نفس اللون، والطرنيب أقوى من بقية الألوان.
 */

export type Suit = 'C' | 'D' | 'H' | 'S';
export type TrumpSuit = Suit | 'NT';

export interface Card {
  /** رمز اللون والحرف: SA, HK, D10, C2 ... */
  code: string;
  s: Suit;
  r: number; // 2..14
}

export type Team = 0 | 1;

export interface SeatPlayer {
  userId: number;
  name: string;
  avatar: string; // emoji أو معرف صورة
  level: number;
  isBot: boolean;
  connected: boolean;
  ready: boolean;
  seat: number;
  team: Team;
  /** آخر وقت ظهور للاعب (لمعرفة الانقطاع) */
  lastSeen?: number;
}

export type Phase = 'waiting' | 'bidding' | 'choosing' | 'reveal' | 'playing' | 'round_end' | 'game_end';

/** تسميات لعبة التركس الخمس */
export type TrixContract = 'kbeh' | 'queens' | 'diamonds' | 'tricks' | 'trix';

export const TRIX_CONTRACTS: TrixContract[] = ['kbeh', 'queens', 'diamonds', 'tricks', 'trix'];

export const TRIX_CONTRACT_AR: Record<TrixContract, string> = {
  kbeh: 'ختيار الكبة',
  queens: 'البنات',
  diamonds: 'الديناري',
  tricks: 'اللطوش',
  trix: 'التركس',
};

export const TRIX_CONTRACT_ICON: Record<TrixContract, string> = {
  kbeh: '👑',
  queens: '👸',
  diamonds: '💎',
  tricks: '🎴',
  trix: '🧩',
};

export const TRIX_CONTRACT_HINT: Record<TrixContract, string> = {
  kbeh: 'تجنّب أخذ K♥ — من يأخذها يخسر 75 نقطة (150 إن كانت مدبّلة)',
  queens: 'كل بنت (Q) تأخذها تخصم 25 نقطة (50 إن كانت مدبّلة)',
  diamonds: 'كل ورقة ديناري تأخذها تخصم 10 نقاط (المجموع 130)',
  tricks: 'كل لطش تأخذه يخصم 15 نقطة (المجموع 195)',
  trix: 'اللعبة الموجبة: رتّب أوراقك على مجموعات تبدأ بالشاب — الأول 200 والثاني 150 والثالث 100 والرابع 50',
};

/** معلومات لعبة التركس داخل حالة الغرفة */
export interface TrixInfo {
  contract: TrixContract | null;
  contractAr: string | null;
  contractIcon: string | null;
  used: TrixContract[];
  legalContracts: TrixContract[];
  mustChooseContract: boolean;
  kingSeat: number;
  kingdom: number;
  kingdoms: number;
  dealNo: number;
  piles: Partial<Record<Suit, { low: number; high: number }>>;
  trickCounts: number[];
  roundScores: number[];
  finished: number[];
  revealed: Record<string, number>;
  canReveal: string[];
  revealReady: boolean;
  revealPhase: boolean;
  lastPlay: { seat: number; card: string } | null;
  taken: string[];
  winnerSeat: number | null;
  isIndividual: boolean;
}

export interface TrixSummary {
  dealNo: number;
  kingdom: number;
  king: number;
  contract: TrixContract;
  contractAr: string;
  roundScores: number[];
  scores: number[];
  trickCounts: number[];
  revealed: Record<string, number>;
  finished: number[];
  /** سبب نهاية التسمية: استنفاد الأوراق المعاقِبة أم انتهاء الأوراق */
  endReason?: 'penalties' | 'cards';
  /** عدد الأوراق التي لم تُلعب (عند النهاية المبكرة) */
  remaining?: number;
  /** كم ورقة معاقِبة أُكلت: كبة/بنات/ديناري */
  penaltyCounts?: { kbeh: number; queen: number; diamond: number };

}

export interface BidInfo {
  /** أعلى طلب حالي (7..13) أو null إن لم يطلب أحد */
  value: number | null;
  /** مقعد صاحب أعلى طلب */
  seat: number | null;
  /** هل تم مضاعفة الطلب */
  doubled: boolean;
  /** من ضاعف */
  doubledBy: number | null;
  /** المقاعد التي مرّرت في هذا المزاد */
  passed: number[];
  /** المقاعد التي يحق لها الطلب الآن */
  eligible: number[];
}

export interface TrickCard {
  seat: number;
  card: Card;
}

export interface PlayedTrick {
  leader: number;
  cards: TrickCard[];
  winner: number | null;
}

export type GameKind = 'tarnib' | 'trix';

export interface RoomSettings {
  /** نوع اللعبة: طرنيب (شراكة) أو تركس (فردية) */
  game: GameKind;
  /** عدد الممالك في التركس: 1 (سريعة) أو 2 أو 4 (كاملة) */
  kingdoms: 1 | 2 | 4;
  /** النقاط المطلوبة للفوز */
  target: 31 | 41 | 61;
  /** السماح بالمضاعفة (دبل) من الفريق الخصم */
  allowDouble: boolean;
  /** السماح بطلبة "بدون طرنيب" */
  allowNoTrump: boolean;
  /** يجب أن يملك المطلوب ورقة واحدة على الأقل من لون الطرنيب */
  requireTrumpInHand: boolean;
  /** مؤقت الدور بالثواني (0 = بلا مؤقت) */
  turnTime: number;
  /** مؤقت المزايدة بالثواني (0 = بلا مؤقت) */
  bidTime: number;
  /** عدد اللمات لكل لاعب كحد أدنى (للمتقدم في اللعب السريع) */
  quickPlay: boolean;
  /** صوت اللعبة مفعّل */
  sound: boolean;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  game: 'tarnib',
  kingdoms: 4,
  target: 31,
  allowDouble: false,
  allowNoTrump: false,
  requireTrumpInHand: false,
  turnTime: 30,
  bidTime: 30,
  quickPlay: false,
  sound: true,
};

/** الأحداث التي تُبث للواجهة لتصدير الحركات والأصوات */
export interface GameEvent {
  id: number;
  t: string; // نوع الحدث
  at: number; // timestamp
  seat?: number;
  team?: Team;
  /** بيانات إضافية */
  [key: string]: unknown;
}

/** حالة الطاولة العامة (تُرسل للاعب بيده فقط) */
export interface PublicState {
  version: number;
  roomCode: string;
  roomName: string;
  phase: Phase;
  seats: (SeatPlayer | null)[];
  mySeat: number;
  dealer: number;
  turn: number;
  /** أوراق اللاعب نفسه فقط */
  myHand: Card[];
  /** أوراق مفلترة (تُعرض عند نهاية الجولة) */
  revealed?: Card[][];
  handCounts: number[];
  trick: TrickCard[];
  trickLeader: number;
  /** آخر أكلة مكتملة (للحركة) */
  lastTrick: PlayedTrick | null;
  tricksWon: [number, number];
  bid: BidInfo;
  trump: TrumpSuit | null;
  /** نقاط الفريقين في الطرنيب — أو نقاط اللاعبين الأربعة في التركس */
  scores: number[];
  round: number;
  roundBids: Record<number, number>; // مقعد -> طلب في هذه الجولة
  target: number;
  settings: RoomSettings;
  /** منتصف الجولة */
  deadline: number | null;
  log: GameEvent[];
  chat: ChatMessage[];
  myTeam: Team;
  /** مؤشر اللاعب اللي عليها الدور */
  isMyTurn: boolean;
  /** الأوراق المسموح لعبها الآن (تحقق من القوانين) */
  legalCards: string[];
  /** الطلبات المسموحة الآن */
  legalBids: number[];
  canPass: boolean;
  canDouble: boolean;
  winnerTeam: Team | null;
  lastRoundSummary: RoundSummary | TrixSummary | null;
  /** نوع اللعبة الجارية */
  game?: GameKind;
  /** تفاصيل لعبة التركس (تظهر عند game = trix) */
  trix?: TrixInfo | null;
}

export interface RoundSummary {
  round: number;
  bid: number;
  bidder: number;
  team: Team;
  made: boolean;
  teamTricks: number;
  trump: TrumpSuit;
  delta: [number, number];
  scores: [number, number];
  kaboot: boolean;
  doubled: boolean;
}

export interface ChatMessage {
  id: number;
  seat: number | null;
  name: string;
  text: string;
  emoji?: string;
  at: number;
  system?: boolean;
}

/** ============================ أدوات الورق ============================ */

export const SUITS: Suit[] = ['C', 'D', 'H', 'S'];
export const SUIT_AR: Record<Suit, string> = { S: 'بستوني', H: 'كوبا', D: 'ديناري', C: 'كبة' };
export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const RANK_LABEL: Record<number, string> = {
  14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10', 9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2',
};

export function makeCard(s: Suit, r: number): Card {
  return { s, r, code: `${s}${r}` };
}

export function parseCard(code: string): Card {
  const s = code[0] as Suit;
  const r = parseInt(code.slice(1), 10);
  return { s, r, code };
}

export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) deck.push(makeCard(s, r));
  return deck;
}

export function cardLabel(code: string): string {
  const c = parseCard(code);
  return `${RANK_LABEL[c.r]}${SUIT_SYMBOL[c.s]}`;
}

export const TEAM_OF_SEAT: Team[] = [0, 1, 0, 1];
export const SEAT_LABEL = ['أنت', 'يمين', 'المقابل', 'يسار'];

/** اللاعب التالي في اتجاه اللعب (عكس عقارب الساعة) */
export function nextSeat(seat: number, step = 1): number {
  return (seat + step) % 4;
}

export function isPartner(a: number, b: number): boolean {
  return TEAM_OF_SEAT[a] === TEAM_OF_SEAT[b];
}

/** ======================= قوانين اللعب الأساسية ======================= */

/** هل الورقة قانونية للعب؟ يجب اتباع اللون إن كان متاحاً */
export function isLegalPlay(hand: Card[], trick: TrickCard[], card: Card): boolean {
  if (!hand.some((c) => c.code === card.code)) return false;
  if (trick.length === 0) return true;
  const led = trick[0].card.s;
  const hasLed = hand.some((c) => c.s === led);
  if (hasLed) return card.s === led;
  return true; // لا يملك اللون → أي ورقة مسموحة (الطرنيب غير إلزامي)
}

export function legalPlays(hand: Card[], trick: TrickCard[]): Card[] {
  return hand.filter((c) => isLegalPlay(hand, trick, c));
}

/** أي ورقة تفوز بالأكلة */
export function trickWinner(trick: TrickCard[], trump: TrumpSuit | null): number {
  let best = trick[0];
  for (const tc of trick.slice(1)) {
    if (beats(tc.card, best.card, trick[0].card.s, trump)) best = tc;
  }
  return best.seat;
}

export function beats(challenger: Card, current: Card, led: Suit, trump: TrumpSuit | null): boolean {
  const cTrump = trump !== 'NT' && trump !== null && challenger.s === trump;
  const wTrump = trump !== 'NT' && trump !== null && current.s === trump;
  if (cTrump && !wTrump) return true;
  if (!cTrump && wTrump) return false;
  if (cTrump && wTrump) return challenger.r > current.r;
  // لا طرنيب في المقارنة
  const cLed = challenger.s === led;
  const wLed = current.s === led;
  if (cLed && !wLed) return true;
  if (!cLed && wLed) return false;
  if (!cLed && !wLed) return false; // كلاهما غير ملون باللون المطروح
  return challenger.r > current.r;
}

/** ============================ حساب النقاط ============================ */
export interface ScoreResult {
  delta: [number, number];
  scores: [number, number];
  made: boolean;
  kaboot: boolean;
  summary: RoundSummary;
}

export function computeScore(
  bid: number,
  bidderSeat: number,
  tricksA: number,
  tricksB: number,
  trump: TrumpSuit,
  doubled: boolean,
  scoresBefore: [number, number],
  round: number,
  target: number,
): ScoreResult {
  const bidTeam = TEAM_OF_SEAT[bidderSeat];
  const bidTricks = bidTeam === 0 ? tricksA : tricksB;
  const defTricks = bidTeam === 0 ? tricksB : tricksA;
  const made = bidTricks >= bid;
  const kaboot = bidTricks === 13;
  const delta: [number, number] = [0, 0];
  let defenderFactor = 1;

  if (made) {
    if (bid === 13) {
      delta[bidTeam] = 26;
    } else if (kaboot) {
      delta[bidTeam] = 16; // 13 + 3 مكافأة الكبوت
    } else {
      delta[bidTeam] = bidTricks;
    }
    if (doubled && bid !== 13) delta[bidTeam] *= 2;
    if (doubled && bid === 13) delta[bidTeam] = 52; // مضاعفة الكبوت
  } else {
    if (bid === 13) {
      delta[bidTeam] = -16;
      defenderFactor = 2; // الفريق الآخر يسجل ضعف أكلاته
    } else {
      delta[bidTeam] = doubled ? -2 * bid : -bid;
    }
    delta[bidTeam === 0 ? 1 : 0] = defTricks * defenderFactor;
  }

  const scores: [number, number] = [scoresBefore[0] + delta[0], scoresBefore[1] + delta[1]];
  const summary: RoundSummary = {
    round,
    bid,
    bidder: bidderSeat,
    team: bidTeam,
    made,
    teamTricks: bidTricks,
    trump,
    delta,
    scores,
    kaboot,
    doubled,
  };
  void target;
  return { delta, scores, made, kaboot, summary };
}

/** المزايدة: أقل طلب 7 وأعلى 13 */
export const MIN_BID = 7;
export const MAX_BID = 13;

export function legalBids(current: number | null): number[] {
  const start = current === null ? MIN_BID : current + 1;
  const bids: number[] = [];
  for (let v = start; v <= MAX_BID; v++) bids.push(v);
  return bids;
}

/* ==========================================================================
 * أنواع الاتصال بالخادم (Wire format)
 * الخادم يرسل الأوراق كأكواد نصية: "SA" لا، بل الترتيب رقمي: "S14", "H10", "C2"
 * ========================================================================== */

/** ورقة مطروحة في الأكلة (من الخادم) */
export interface WireTrickCard {
  seat: number;
  /** كود الورقة: مثال "S14" (آس البستوني) أو "H10" أو "C2" */
  card: string;
}

export interface WireTrick {
  leader: number;
  cards: WireTrickCard[];
  winner: number | null;
}

export interface WireChat {
  id: number;
  seat: number | null;
  name: string;
  text: string;
  emoji?: string;
  at: number;
}

export interface SwapRequest {
  from: number;
  to: number;
  name: string;
}

/** الحالة المشتركة للطاولة (تُبنى من الخادم أو من اللعب المحلي) */
export interface TableState {
  phase: Phase;
  seats: (SeatPlayer | null)[];
  mySeat: number;
  settings: RoomSettings;
  target: number;
  dealer: number;
  turn: number;
  /** أوراقي (أكواد) */
  myHand: string[];
  revealed?: string[][] | null;
  handCounts: number[];
  trick: WireTrickCard[];
  trickLeader: number;
  lastTrick: WireTrick | null;
  tricksWon: [number, number];
  bid: BidInfo;
  trump: TrumpSuit | null;
  /** نقاط الفريقين في الطرنيب — أو نقاط اللاعبين الأربعة في التركس */
  scores: number[];
  round: number;
  roundBids: Record<string, number>;
  /** الوقت المتبقي للدور بالمللي ثانية */
  deadline: number | null;
  log: GameEvent[];
  chat: WireChat[];
  myTeam: Team;
  isMyTurn: boolean;
  legalCards: string[];
  legalBids: number[];
  canPass: boolean;
  canDouble: boolean;
  mustChooseTrump?: boolean;
  wonTrick?: boolean;
  winnerTeam: Team | null;
  lastRoundSummary: RoundSummary | TrixSummary | null;
  /** نوع اللعبة الجارية */
  game?: GameKind;
  /** تفاصيل لعبة التركس (تظهر عند game = trix) */
  trix?: TrixInfo | null;
}

/** حالة الغرفة كما يرسلها الخادم */
export interface RoomState extends TableState {
  version: number;
  roomId: string;
  roomCode: string;
  roomName: string;
  hostId: number;
  isHost: boolean;
  status: string;
  isSpectator: boolean;
  swapRequests: SwapRequest[];
  allReady: boolean;
}

/** عنصر قائمة الغرف في الردهة */
export interface RoomListItem {
  id: string;
  code: string;
  name: string;
  status: string;
  players: number;
  humans: number;
  maxPlayers: number;
  /** نوع اللعبة في هذه الطاولة */
  game?: GameKind;
  kingdoms?: number;
  target: number;
  round: number;
  scores: [number, number];
  hasPassword: boolean;
  updatedAt: number;
}

export interface LobbyStats {
  online: number;
  rooms: number;
  playersInGame: number;
  matches: number;
}

export interface LeaderboardPlayer {
  rank: number;
  id: number;
  name: string;
  avatar: string;
  level: number;
  xp: number;
  wins: number;
  played: number;
  winRate: number;
  kaboot: number;
  maxStreak: number;
}

export interface ShopItem {
  id: string;
  type: 'cardBack' | 'tableTheme' | 'frame';
  name: string;
  price: number;
  value: string;
  icon: string;
}
