/**
 * محرك اللعب المحلي (بدون إنترنت) — نفس قوانين الخادم
 * يستخدم للعب السريع ضد البوتات، ولتجربة اللعبة على شاشة البداية.
 */
import type { Card, GameEvent, RoomSettings, RoomState, SeatPlayer, Suit, Team, TrickCard, TrumpSuit, RoundSummary } from './types';
import { DEFAULT_SETTINGS, TEAM_OF_SEAT } from './types';
import { botBid, botChooseTrump, botPlay, type BotContext } from './bots';

export interface OfflineOptions {
  playerName: string;
  avatar: string;
  playerLevel?: number;
  target?: number;
  botNames?: string[];
  settings?: Partial<RoomSettings>;
}

const BOT_AVATARS = ['🤖', '👾', '🐯'];
const BOT_NAMES = ['بوت ليلى', 'بوت كريم', 'بوت نور'];

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ s, r, code: `${s}${r}` });
  return deck;
}

export class OfflineMatch {
  seats: SeatPlayer[];
  settings: RoomSettings;
  target: number;
  mySeat: number;
  private hands: Card[][] = [[], [], [], []];
  private deck: Card[] = [];
  phase: RoomState['phase'] = 'bidding';
  dealer = 3;
  turn = 0;
  trump: TrumpSuit | null = null;
  tricksWon: [number, number] = [0, 0];
  scores: [number, number] = [0, 0];
  round = 0;
  bidValue: number | null = null;
  bidSeat: number | null = null;
  doubled = false;
  doubledBy: number | null = null;
  passed: number[] = [];
  roundBids: Record<number, number> = {};
  trick: TrickCard[] = [];
  trickLeader = 0;
  lastTrick: { leader: number; cards: TrickCard[]; winner: number } | null = null;
  winnerTeam: Team | null = null;
  summary: RoundSummary | null = null;
  log: GameEvent[] = [];
  waitingResolve = false;
  private eventId = 0;
  private chatId = 0;
  private version = 1;
  readonly chat: { id: number; seat: number | null; name: string; text: string; at: number }[] = [];
  allTricks: TrickCard[][] = [];
  private rnd: () => number;

  constructor(opts: OfflineOptions) {
    this.settings = { ...DEFAULT_SETTINGS, ...opts.settings, target: (opts.target ?? 31) as RoomSettings['target'] };
    this.target = this.settings.target;
    this.mySeat = Math.floor(Math.random() * 4);
    const botAvatars = [...BOT_AVATARS];
    const botNames = opts.botNames ?? BOT_NAMES;
    this.seats = [0, 1, 2, 3].map((seat) => {
      const team: Team = (seat % 2) as Team;
      if (seat === this.mySeat) {
        return {
          seat, team, userId: 1, name: opts.playerName, avatar: opts.avatar,
          isBot: false, level: opts.playerLevel ?? 1, connected: true, ready: true,
        };
      }
      const i = (seat + 4 - this.mySeat) % 4 - 1;
      return {
        seat, team, userId: 100 + seat,
        name: botNames[i % botNames.length],
        avatar: botAvatars[i % botAvatars.length],
        isBot: true, level: 2 + (i % 3), connected: true, ready: true,
      };
    });
    this.rnd = () => Math.random();
    this.deal();
  }

  /* ============================ الأحداث ============================ */

  private event(t: string, data: Record<string, unknown> = {}): void {
    this.eventId += 1;
    this.version += 1;
    this.log.push({ id: this.eventId, t, at: Date.now(), ...data });
    if (this.log.length > 80) this.log = this.log.slice(-80);
  }

  pushChat(seat: number | null, text: string): void {
    this.chatId += 1;
    this.version += 1;
    this.chat.push({ id: this.chatId, seat, name: seat === null ? 'النظام' : this.seats[seat].name, text, at: Date.now() });
    if (this.chat.length > 60) this.chat.splice(0, this.chat.length - 60);
  }

  /* ============================ التوزيع ============================ */

  private deal(): void {
    this.deck = shuffle(fullDeck(), this.rnd);
    this.hands = [[], [], [], []];
    for (let i = 0; i < 52; i++) this.hands[i % 4].push(this.deck[i]);
    for (const h of this.hands) h.sort((a, b) => (a.s === b.s ? b.r - a.r : a.s.localeCompare(b.s)));
    this.phase = 'bidding';
    this.turn = (this.dealer + 1) % 4;
    this.trump = null;
    this.trick = [];
    this.lastTrick = null;
    this.tricksWon = [0, 0];
    this.bidValue = null;
    this.bidSeat = null;
    this.doubled = false;
    this.doubledBy = null;
    this.passed = [];
    this.roundBids = {};
    this.waitingResolve = false;
    this.round += 1;
    this.allTricks = [];
    this.event('deal', { round: this.round, dealer: this.dealer, turn: this.turn });
  }

  private redeal(): void {
    this.event('redeal', { text: 'الجميع مرّر — إعادة التوزيع' });
    this.round -= 1;
    this.deal();
  }

  /* ============================ المزايدة ============================ */

  legalBids(): number[] {
    const start = this.bidValue === null ? 7 : this.bidValue + 1;
    const out: number[] = [];
    for (let v = start; v <= 13; v++) out.push(v);
    return out;
  }

  canDouble(seat: number): boolean {
    return (
      this.settings.allowDouble &&
      !this.doubled &&
      this.bidSeat !== null &&
      this.bidSeat !== seat &&
      TEAM_OF_SEAT[this.bidSeat] !== TEAM_OF_SEAT[seat]
    );
  }

  canPass(seat: number): boolean {
    return this.bidValue !== null && !this.passed.includes(seat) && this.turn === seat;
  }

  bid(seat: number, value: number): boolean {
    if (this.phase !== 'bidding' || this.turn !== seat) return false;
    if (value < 7 || value > 13 || (this.bidValue !== null && value <= this.bidValue)) return false;
    this.bidValue = value;
    this.bidSeat = seat;
    this.roundBids[seat] = value;
    this.event('bid', { seat, value });
    this.advanceAuction();
    return true;
  }

  pass(seat: number): boolean {
    if (this.phase !== 'bidding' || this.turn !== seat) return false;
    if (!this.passed.includes(seat)) this.passed.push(seat);
    this.event('pass', { seat });
    this.advanceAuction();
    return true;
  }

  double(seat: number): boolean {
    if (!this.canDouble(seat) || this.turn !== seat) return false;
    this.doubled = true;
    this.doubledBy = seat;
    this.event('double', { seat, value: this.bidValue });
    this.advanceAuction();
    return true;
  }

  private advanceAuction(): void {
    const active = [0, 1, 2, 3].filter((s) => !this.passed.includes(s));
    if (active.length === 0) {
      this.redeal();
      return;
    }
    if (active.length === 1 && this.bidSeat !== null) {
      this.event('auction_end', { seat: this.bidSeat, value: this.bidValue, doubled: this.doubled });
      // اختيار الطرنيب
      this.turn = this.bidSeat;
      return;
    }
    // الانتقال للاعب التالي غير الممرِّر
    let next = (this.turn + 1) % 4;
    for (let i = 0; i < 4 && this.passed.includes(next); i++) next = (next + 1) % 4;
    this.turn = next;
    this.event('turn', { seat: next });
  }

  mustChooseTrump(): boolean {
    return this.phase === 'bidding' && this.bidSeat !== null && this.turn === this.bidSeat && this.passed.length === 3;
  }

  chooseTrump(seat: number, suit: TrumpSuit): boolean {
    if (!this.mustChooseTrump() || seat !== this.bidSeat) return false;
    if (suit === 'NT' && !this.settings.allowNoTrump) return false;
    this.trump = suit;
    this.phase = 'playing';
    this.turn = seat;
    this.trickLeader = seat;
    this.event('trump', { seat, suit });
    return true;
  }

  /** اختيار تلقائي للطرنيب للبوت */
  autoTrump(seat: number): TrumpSuit {
    return botChooseTrump(this.hands[seat], this.settings.allowNoTrump);
  }

  /* ============================ اللعب ============================ */

  legalCards(seat: number): string[] {
    const hand = this.hands[seat];
    if (this.trick.length === 0) return hand.map((c) => c.code);
    const led = this.trick[0].card.s;
    const hasLed = hand.some((c) => c.s === led);
    return hand.filter((c) => (hasLed ? c.s === led : true)).map((c) => c.code);
  }

  play(seat: number, code: string): boolean {
    if (this.phase !== 'playing' || this.turn !== seat || this.waitingResolve) return false;
    if (!this.legalCards(seat).includes(code)) return false;
    const idx = this.hands[seat].findIndex((c) => c.code === code);
    if (idx < 0) return false;
    const [card] = this.hands[seat].splice(idx, 1);
    this.trick.push({ seat, card });
    this.event('play', { seat, card: code });
    if (this.trick.length === 4) {
      this.waitingResolve = true;
    } else {
      this.turn = (seat + 1) % 4;
      this.event('turn', { seat: this.turn });
    }
    return true;
  }

  /** حسم الأكلة (يُستدعى بعد انتهاء الحركة) */
  resolveTrick(): number {
    if (this.trick.length !== 4) return -1;
    const winner = this.trickWinner();
    const team = TEAM_OF_SEAT[winner];
    this.tricksWon[team] += 1;
    this.allTricks.push([...this.trick]);
    this.lastTrick = { leader: this.trick[0].seat, cards: [...this.trick], winner };
    this.event('trick', { seat: winner, team, tricks: this.tricksWon[team] });
    this.trick = [];
    this.waitingResolve = false;
    this.turn = winner;
    this.trickLeader = winner;
    if (this.hands.every((h) => h.length === 0)) {
      this.endRound();
    } else {
      this.event('turn', { seat: winner });
    }
    return winner;
  }

  trickWinner(): number {
    const trump = this.trump;
    const led = this.trick[0].card.s;
    let best = this.trick[0];
    for (const tc of this.trick.slice(1)) {
      const better = this.beats(tc.card, best.card, led, trump);
      if (better) best = tc;
    }
    return best.seat;
  }

  private beats(challenger: Card, current: Card, led: Suit, trump: TrumpSuit | null): boolean {
    const isTrump = (c: Card) => trump !== null && trump !== 'NT' && c.s === trump;
    const ct = isTrump(challenger);
    const wt = isTrump(current);
    if (ct !== wt) return ct;
    if (ct && wt) return challenger.r > current.r;
    const cl = challenger.s === led;
    const wl = current.s === led;
    if (cl !== wl) return cl;
    if (!cl && !wl) return false;
    return challenger.r > current.r;
  }

  /* ============================ الحساب ============================ */

  private endRound(): void {
    const bid = this.bidValue ?? 7;
    const bidderTeam = TEAM_OF_SEAT[this.bidSeat ?? 0];
    const bidTricks = this.tricksWon[bidderTeam];
    const made = bidTricks >= bid;
    const kaboot = made && bidTricks === 13 && bid < 13;
    const delta: [number, number] = [0, 0];
    let defenderFactor = 1;
    if (made) {
      if (bid === 13) delta[bidderTeam] = 26;
      else if (kaboot) delta[bidderTeam] = 16;
      else delta[bidderTeam] = bidTricks;
      if (this.doubled) delta[bidderTeam] *= 2;
    } else {
      if (bid === 13) {
        delta[bidderTeam] = -16;
        defenderFactor = 2;
      } else {
        delta[bidderTeam] = this.doubled ? -2 * bid : -bid;
      }
      delta[bidderTeam === 0 ? 1 : 0] =
        (bidderTeam === 0 ? this.tricksWon[1] : this.tricksWon[0]) * defenderFactor;
    }
    this.scores = [this.scores[0] + delta[0], this.scores[1] + delta[1]];
    this.summary = {
      round: this.round,
      bid,
      bidder: this.bidSeat ?? 0,
      team: bidderTeam,
      made,
      teamTricks: bidTricks,
      trump: this.trump ?? 'NT',
      delta,
      scores: this.scores,
      kaboot,
      doubled: this.doubled,
    };
    this.event('round_end', { ...this.summary } as unknown as Record<string, unknown>);
    const reached = this.scores[0] >= this.target || this.scores[1] >= this.target;
    if (reached) {
      this.winnerTeam = this.scores[0] > this.scores[1] ? 0 : 1;
      this.phase = 'game_end';
      this.event('game_end', { team: this.winnerTeam, scores: this.scores });
    } else {
      this.phase = 'round_end';
    }
  }

  /** بدء الجولة التالية */
  nextRound(): void {
    this.dealer = (this.dealer + 1) % 4;
    this.round -= 1; // deal() يزيدها
    this.deal();
  }

  /* ============================ البوتات ============================ */

  /**
   * تنفيذ خطوة للدور الحالي
   * @param force أجبر التنفيذ حتى لو كان المقعد لاعباً حقيقياً (للاختبار واللعب التلقائي)
   */
  botStep(force = false): void {
    const seat = this.turn;
    if (!force && this.seats[seat]?.isBot !== true) return;
    if (this.phase === 'bidding') {
      if (this.mustChooseTrump()) {
        const suit = botChooseTrump(this.hands[seat], this.settings.allowNoTrump);
        this.chooseTrump(seat, suit);
        return;
      }
      const ctx: BotContext = {
        hand: this.hands[seat],
        currentBid: this.bidValue,
        bidderSeat: this.bidSeat,
        partner: (seat + 2) % 4,
        dealer: this.dealer,
        passed: [...this.passed],
        seat,
        settings: this.settings,
      };
      const decision = botBid(ctx);
      if (decision.type === 'bid') this.bid(seat, decision.value);
      else if (decision.type === 'double') this.double(seat);
      else this.pass(seat);
      return;
    }
    if (this.phase === 'playing') {
      const code = botPlay({
        hand: this.hands[seat],
        trick: this.trick,
        trump: this.trump,
        leader: this.trickLeader,
        seat,
        partner: (seat + 2) % 4,
        bidSeat: this.bidSeat,
        tricksWon: this.tricksWon,
        bidValue: this.bidValue,
        played: this.allTricks.flat().map((t) => t.card),
      });
      this.play(seat, code);
    }
  }

  /** إرسال رسالة من بوت أحياناً */
  maybeBotChat(): void {
    if (Math.random() > 0.12) return;
    const seat = [0, 1, 2, 3].find((s) => this.seats[s].isBot);
    if (seat === undefined) return;
    const phrases = ['يلا بينا 💪', 'ورق حلو 🍀', 'برافو 👏', 'ركّز معي 😅', 'الله يعين 😩', 'دورك 🙌'];
    this.pushChat(seat, phrases[Math.floor(Math.random() * phrases.length)]);
  }

  /* ============================ اللقطة العامة ============================ */

  snapshot(): RoomState {
    const myTurn = this.turn === this.mySeat;
    const revealed =
      this.phase === 'round_end' || this.phase === 'game_end' ? this.hands.map((h) => h.map((c) => c.code)) : null;
    return {
      version: this.version,
      roomId: 'offline',
      roomCode: 'BOTS',
      roomName: 'تدريب ضد البوتات',
      hostId: this.mySeat,
      isHost: true,
      status: this.phase === 'game_end' ? 'finished' : 'playing',
      isSpectator: false,
      swapRequests: [],
      allReady: true,
      phase: this.phase,
      seats: this.seats,
      mySeat: this.mySeat,
      settings: this.settings,
      target: this.target,
      dealer: this.dealer,
      turn: this.turn,
      myHand: this.hands[this.mySeat].map((c) => c.code),
      revealed,
      handCounts: this.hands.map((h) => h.length),
      trick: this.trick.map((t) => ({ seat: t.seat, card: t.card.code })),
      trickLeader: this.trickLeader,
      lastTrick: this.lastTrick
        ? { leader: this.lastTrick.leader, winner: this.lastTrick.winner, cards: this.lastTrick.cards.map((t) => ({ seat: t.seat, card: t.card.code })) }
        : null,
      tricksWon: [...this.tricksWon] as [number, number],
      bid: {
        value: this.bidValue,
        seat: this.bidSeat,
        doubled: this.doubled,
        doubledBy: this.doubledBy,
        passed: [...this.passed],
        eligible: [],
      },
      trump: this.trump,
      scores: [...this.scores] as [number, number],
      round: this.round,
      roundBids: { ...this.roundBids },
      deadline: null,
      log: [...this.log],
      chat: [...this.chat],
      myTeam: (this.mySeat % 2) as Team,
      isMyTurn: myTurn,
      legalCards: this.phase === 'playing' && myTurn && !this.waitingResolve ? this.legalCards(this.mySeat) : [],
      legalBids: this.phase === 'bidding' && myTurn && !this.mustChooseTrump() ? this.legalBids() : [],
      canPass: this.phase === 'bidding' && myTurn && this.bidValue !== null && !this.mustChooseTrump(),
      canDouble: this.phase === 'bidding' && myTurn && this.canDouble(this.mySeat) && !this.mustChooseTrump(),
      mustChooseTrump: this.mustChooseTrump() && this.turn === this.mySeat,
      wonTrick: this.trick.length === 4,
      winnerTeam: this.winnerTeam,
      lastRoundSummary: this.summary,
    };
  }
}
