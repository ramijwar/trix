/**
 * ذكاء اصطناعي لاعبي البوت (يُستخدم في اللعب المحلي وفي وضع التجربة)
 * ملاحظة: البوت لا يرى أوراق الآخرين — يقرر فقط من يده ومن الأوراق التي لُعبت.
 */
import type { Card, RoomSettings, Suit, TrickCard, TrumpSuit } from './types';
import { MIN_BID, SUITS, TEAM_OF_SEAT } from './types';

export interface BotContext {
  hand: Card[];
  currentBid: number | null;
  /** مقعد صاحب أعلى طلب حالي (null إن لا أحد) */
  bidderSeat: number | null;
  partner: number;
  dealer: number;
  passed: number[];
  seat: number;
  settings: RoomSettings;
}

export type BidDecision = { type: 'bid'; value: number } | { type: 'pass' } | { type: 'double' };

/** قوة الأوراق العالية — مُعايرة بمحاكاة كاملة لضبط نسبة نجاح الطلبات */
const TRUMP_POWER: Record<number, number> = { 14: 1.15, 13: 0.95, 12: 0.75, 11: 0.5, 10: 0.3, 9: 0.15 };
const SIDE_POWER: Record<number, number> = { 14: 0.95, 13: 0.6, 12: 0.32, 11: 0.16, 10: 0.08 };

/**
 * جدول المزايدة المُعاير بمحاكاة 1500+ جولة:
 * قوة اليد (بالأكلات) → الطلب الذي تنجح به اليد باحتمال 60–70%
 * القيم مأخوذة من قياس فعلي لأكلات الفريق مقابل قوة يد المعلن.
 */
export const STRENGTH_TO_BID: Array<[number, number]> = [
  [6.45, 13],
  [5.95, 12],
  [5.45, 11],
  [4.95, 10],
  [4.35, 9],
  [3.85, 8],
  [2.95, 7],
];

/** أدنى قوة تُسمح بها المضاعفة (الخصم يطلب عالياً ويدنا ضعيفة) */
export const DOUBLE_MAX_STRENGTH = 2.2;
/** أدنى قوة لفتح المزاد إن مرّر الجميع (لتجنّب إعادة التوزيع) */
export const FORCED_OPEN_STRENGTH = 2.35;
/** أدنى قوة للرفع على الشريك */
export const RAISE_PARTNER_STRENGTH = 4.2;

/** تقدير الطلب المناسب لقوة اليد (0 = لا تطلب) */
export function bidFromStrength(strength: number): number {
  for (const [need, bid] of STRENGTH_TO_BID) {
    if (strength >= need) return bid;
  }
  return 0;
}

/** القوة المتوقعة للون طرنيب معيّن (بالأكلات) */
export function estimateTricks(hand: Card[], trump: TrumpSuit): number {
  let tricks = 0;
  for (const s of SUITS) {
    const cards = hand.filter((c) => c.s === s).sort((a, b) => b.r - a.r);
    if (!cards.length) continue;
    if (s === trump) {
      tricks += TRUMP_POWER[cards[0].r] ?? 0.05;
      if (cards[1]) tricks += (TRUMP_POWER[cards[1].r] ?? 0.05) * 0.55;
      if (cards[2]) tricks += (TRUMP_POWER[cards[2].r] ?? 0.05) * 0.3;
      if (cards.length >= 4) tricks += (cards.length - 3) * 0.3;
    } else {
      tricks += SIDE_POWER[cards[0].r] ?? 0.05;
      if (cards[1]) tricks += (SIDE_POWER[cards[1].r] ?? 0.05) * 0.45;
      if (cards.length === 1) tricks += 0.35;
      else if (cards.length === 2) tricks += 0.16;
      else if (cards.length >= 5) tricks += (cards.length - 4) * 0.1;
    }
  }
  return tricks;
}

/** أفضل لون للطرنيب حسب اليد */
export function bestTrump(hand: Card[]): Suit {
  let best: Suit = 'S';
  let bestScore = -1;
  for (const s of SUITS) {
    const cards = hand.filter((c) => c.s === s);
    const score = cards.length * 1.1 + cards.reduce((a, c) => a + (TRUMP_POWER[c.r] ?? 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

/** اختيار لون الطرنيب الذي يحقق أفضل قوة للبوت */
export function botChooseTrump(hand: Card[], allowNoTrump: boolean): TrumpSuit {
  const suit = bestTrump(hand);
  const withTrump = estimateTricks(hand, suit);
  const noTrump = estimateTricks(hand, 'NT');
  if (allowNoTrump && noTrump >= withTrump + 1.0) return 'NT';
  return suit;
}

/** أعلى قوة عبر الألوان الأربعة */
export function handStrength(hand: Card[]): number {
  return SUITS.reduce((acc, s) => Math.max(acc, estimateTricks(hand, s)), 0);
}

export function botBid(ctx: BotContext): BidDecision {
  const strength = handStrength(ctx.hand);
  const target = bidFromStrength(strength);
  const current = ctx.currentBid;
  const min = current === null ? MIN_BID : current + 1;
  const partnerBidding = current !== null && ctx.bidderSeat !== null && ctx.bidderSeat === ctx.partner;
  const opponentBidding = current !== null && ctx.bidderSeat !== null && (ctx.bidderSeat % 2) !== (ctx.seat % 2);

  // المضاعفة: الخصم يطلب عالياً ويدنا ضعيفة → احتمال كبير لفشله
  if (
    ctx.settings.allowDouble &&
    opponentBidding &&
    current !== null &&
    current >= 10 &&
    strength <= DOUBLE_MAX_STRENGTH &&
    Math.random() < 0.35
  ) {
    return { type: 'double' };
  }

  if (target === 0) {
    // الجميع مرّر: نفتح بطلب 7 حتى لا تتكرر إعادة التوزيع
    if (current === null && ctx.passed.length >= 3 && strength >= FORCED_OPEN_STRENGTH) {
      return { type: 'bid', value: 7 };
    }
    return { type: 'pass' };
  }

  if (target < min) {
    return { type: 'pass' };
  }
  if (partnerBidding && strength < RAISE_PARTNER_STRENGTH) {
    return { type: 'pass' };
  }
  // اطلب أقل قيمة تكفي للتقدم في المزاد، وليس أعلى ما تسمح به اليد
  return { type: 'bid', value: min };
}

export interface PlayContext {
  hand: Card[];
  trick: TrickCard[];
  trump: TrumpSuit | null;
  leader: number;
  seat: number;
  partner: number;
  bidSeat: number | null;
  tricksWon: [number, number];
  bidValue: number | null;
  played: Card[];
}

function isTrumpCard(c: Card, trump: TrumpSuit | null): boolean {
  return trump !== null && trump !== 'NT' && c.s === trump;
}

function rankWeight(c: Card): number {
  return c.r;
}

/** هل تفوز هذه الورقة حالياً بالأكلة؟ */
function winsNow(card: Card, trick: TrickCard[], trump: TrumpSuit | null): boolean {
  if (trick.length === 0) return true;
  const led = trick[0].card.s;
  const contenders = [...trick.map((t) => t.card), card];
  const isT = (c: Card) => isTrumpCard(c, trump);
  const trumps = contenders.filter(isT);
  if (trumps.length) {
    return isT(card) && trumps.every((c) => c.r <= card.r);
  }
  const ofLed = contenders.filter((c) => c.s === led);
  return card.s === led && ofLed.every((c) => c.r <= card.r);
}

/** اختيار ورقة للعب */
export function botPlay(ctx: PlayContext): string {
  const legal = legalFor(ctx);
  if (legal.length === 0) return ctx.hand[0].code;
  if (ctx.trick.length === 0) return leadCard(ctx, legal);
  return followCard(ctx, legal);
}

function legalFor(ctx: PlayContext): Card[] {
  if (ctx.trick.length === 0) return ctx.hand;
  const led = ctx.trick[0].card.s;
  const has = ctx.hand.some((c) => c.s === led);
  return has ? ctx.hand.filter((c) => c.s === led) : ctx.hand;
}

function leadCard(ctx: PlayContext, legal: Card[]): string {
  const trump = ctx.trump;
  const iAmDeclarer = ctx.bidSeat === ctx.seat;
  const myTeam = TEAM_OF_SEAT[ctx.seat];
  const needTricks = ctx.bidValue !== null && ctx.tricksWon[myTeam] < Math.ceil(ctx.bidValue / 2);
  // اسحب أوراق الطرنيب إن كنت المعلن ومعك عدد كبير منها
  const trumpsInHand = ctx.hand.filter((c) => isTrumpCard(c, trump)).length;
  if (iAmDeclarer && trumpsInHand >= 4) {
    const t = legal.filter((c) => isTrumpCard(c, trump)).sort((a, b) => rankWeight(b) - rankWeight(a))[0];
    if (t) return t.code;
  }
  // ابدأ بأقوى ورقة في لون طويل إن كنّا نحتاج أكلات
  const bySuit = new Map<Suit, Card[]>();
  for (const c of legal) {
    const arr = bySuit.get(c.s) ?? [];
    arr.push(c);
    bySuit.set(c.s, arr);
  }
  let best: Card | null = null;
  let bestScore = -Infinity;
  for (const [suit, cards] of bySuit) {
    cards.sort((a, b) => rankWeight(b) - rankWeight(a));
    const top = cards[0];
    const playedInSuit = ctx.played.filter((c) => c.s === suit);
    const higherOut = playedInSuit.filter((c) => c.r > top.r).length;
    const score =
      (top.r - 8) * 0.55 - higherOut * 1.5 + (cards.length >= 4 ? 1.1 : 0) + (isTrumpCard(top, trump) ? -1.6 : 0) + (needTricks ? 0.8 : -0.2);
    if (score > bestScore) {
      bestScore = score;
      best = top;
    }
  }
  if (best) return best.code;
  return legal[0].code;
}

function followCard(ctx: PlayContext, legal: Card[]): string {
  const trump = ctx.trump;
  const trick = ctx.trick;
  const led = trick[0].card.s;
  const winnerSeat = trickWinnerSeat(trick, trump);
  const partnerWinning = winnerSeat === ctx.partner;
  const partnerLast = trick.length === 3 && partnerWinning;

  const sorted = [...legal].sort((a, b) => rankWeight(a) - rankWeight(b));
  const winners = sorted.filter((c) => winsNow(c, trick, trump));
  const myTeam = TEAM_OF_SEAT[ctx.seat];
  const need = ctx.bidValue !== null ? Math.max(0, ctx.bidValue - ctx.tricksWon[myTeam]) : 0;
  const opponentLeading = !partnerWinning;

  // لو الشريك فائز والأكلة الأخيرة/الورقة الأخيرة لا داعي لحرق أوراق عالية
  if (partnerLast) return sorted[0].code;

  if (winners.length && (opponentLeading || need > 0 || trick.length === 3)) {
    // أحرق أرخص ورقة فائزة، وفضّل غير الطرنيب
    const nonTrumpWinner = winners.find((c) => !isTrumpCard(c, trump));
    return (nonTrumpWinner ?? winners[0]).code;
  }
  // لا يمكن الفوز: تخلّص من أدنى ورقة، وتجنّب الطرنيب إن أمكن
  const nonTrump = sorted.filter((c) => !isTrumpCard(c, trump));
  const pool = nonTrump.length ? nonTrump : sorted;
  // فضّل الألوان القصيرة للتخلص من الأوراق المفردة
  const suitCounts = new Map<Suit, number>();
  for (const c of ctx.hand) suitCounts.set(c.s, (suitCounts.get(c.s) ?? 0) + 1);
  const isLed = (c: Card) => c.s === led;
  return (
    pool
      .slice()
      .sort((a, b) => {
        const ca = suitCounts.get(a.s) ?? 0;
        const cb = suitCounts.get(b.s) ?? 0;
        if (ca !== cb) return ca - cb;
        return rankWeight(a) - rankWeight(b);
      })
      .find(isLed)?.code ?? pool[0].code
  );
}

function trickWinnerSeat(trick: TrickCard[], trump: TrumpSuit | null): number {
  const led = trick[0].card.s;
  let best = trick[0];
  for (const t of trick.slice(1)) {
    const isT = (c: Card) => isTrumpCard(c, trump);
    const ct = isT(t.card);
    const wt = isT(best.card);
    let better = false;
    if (ct !== wt) better = ct;
    else if (ct && wt) better = t.card.r > best.card.r;
    else {
      const cl = t.card.s === led;
      const wl = best.card.s === led;
      if (cl !== wl) better = cl;
      else if (cl && wl) better = t.card.r > best.card.r;
    }
    if (better) best = t;
  }
  return best.seat;
}
