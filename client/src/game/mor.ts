/**
 * قوانين لعبة المور (MOR) — نسخة الواجهة
 * ------------------------------------------------------------------
 * تُستخدم للتحقق الفوري من النزولات وإظهار التلميحات قبل إرسال الحركة للخادم.
 * نفس القوانين مطبَّقة في الخادم (server/src/Game/Mor.php) وهو المرجع النهائي.
 *
 * • الورق: مجموعتان (١٠٤) + جوكران — الرمز مثل الخادم: H3, S14 (آس), X1 (جوكر)
 * • ٢ والجوكر مبدّلان، والحد الأقصى جوكر واحد + ٢ واحد في النزول
 * • النزول: سلسلة (٣+ متتالية بنفس اللون) أو طقم (ثلاثات فقط أو أصوص فقط)
 * • المشروع: ٧ أوراق أو أكثر — ٣٠٠/٢٠٠/١٥٠/١٠٠
 */

export type MorMeldKind = 'seq' | 'set';
export type MorMode = 'jawaker' | 'popular';

export interface MorMeld {
  id: number;
  kind: MorMeldKind;
  cards: string[];
  by: number;
  points: number;
  project: boolean;
  clean: boolean;
  count: number;
}

export interface MorState {
  mode: MorMode;
  roundNo: number;
  deckCount: number;
  discard: string[];
  discardCount: number;
  discardTop: string | null;
  morCounts: [number, number];
  morTaken: [boolean, boolean];
  melds: [MorMeld[], MorMeld[]];
  teamProjects: [number, number];
  canClose: [boolean, boolean];
  needDraw: boolean;
  pilePending: boolean;
  /** أوراق كومة الرمي التي بيدك — يجب استخدام واحدة منها قبل الرمي */
  pileCards: string[];
  canTakePile: boolean;
  canTakeMor: boolean;
  canCloseNow: boolean;
  continue: number[];
}

export const MOR_MODE_AR: Record<MorMode, string> = {
  jawaker: 'طريقة جواكر',
  popular: 'الطريقة الشعبية',
};

export const MOR_TARGETS: Record<MorMode, number[]> = {
  jawaker: [101, 151, 201],
  popular: [501, 1001, 1501],
};

/* ============================ أدوات الورق ============================ */

export function morRank(code: string): number {
  if (!code || code[0] === 'X') return 15;
  return parseInt(code.slice(1), 10) || 0;
}

export function morSuit(code: string): string {
  return code ? code[0] : '';
}

export function isMorJoker(code: string): boolean {
  return Boolean(code) && code[0] === 'X';
}

/** مبدّل: ٢ أو جوكر */
export function isMorWild(code: string): boolean {
  const r = morRank(code);
  return r === 15 || r === 2;
}

/** قيم الورقة — طريقة جواكر */
export function morValueJawaker(code: string): number {
  const r = morRank(code);
  if (r === 15 || r === 14) return 1.5;
  if (r === 7) return 1;
  if (r === 3) return 0.5;
  return 0;
}

/** قيم الورقة — الطريقة الشعبية */
export function morValuePopular(code: string): number {
  const r = morRank(code);
  if (r === 15) return 15;
  if (r === 14) return 11;
  if (r >= 10) return 10;
  return r;
}

export function morCardValue(code: string, mode: MorMode): number {
  return mode === 'popular' ? morValuePopular(code) : morValueJawaker(code);
}

/* ============================ التحقق ============================ */

export interface MorCheck {
  ok: boolean;
  kind: MorMeldKind | null;
  reason: string;
}

function validateSet(naturals: string[], total: number): { ok: boolean; reason: string } {
  const rank = morRank(naturals[0]);
  for (const c of naturals) {
    if (morRank(c) !== rank) return { ok: false, reason: 'أوراق الطقم يجب أن تكون بنفس الرقم' };
  }
  if (rank !== 3 && rank !== 14) return { ok: false, reason: 'الأطقم مسموحة للثلاثات والأصوص فقط' };
  if (total < 3) return { ok: false, reason: 'النزول يحتاج ٣ أوراق على الأقل' };
  return { ok: true, reason: '' };
}

function validateSequence(naturals: string[], total: number): { ok: boolean; reason: string } {
  const suit = morSuit(naturals[0]);
  for (const c of naturals) {
    if (morSuit(c) !== suit) return { ok: false, reason: 'السلسلة تحتاج أوراقاً بنفس اللون' };
  }
  const ladders: [number, number][] = [[1, 13], [3, 14]];
  let bestReason = '';
  for (const [min, max] of ladders) {
    const positions = new Set<number>();
    let bad = false;
    for (const c of naturals) {
      const r = morRank(c);
      const pos = r === 14 ? (min === 1 ? 1 : 14) : r;
      if (pos < min || pos > max || positions.has(pos)) {
        bad = true;
        break;
      }
      positions.add(pos);
    }
    if (bad) {
      bestReason = 'ترتيب الأوراق غير صالح (تكرار أو خارج نطاق السلسلة)';
      continue;
    }
    const keys = [...positions].sort((a, b) => a - b);
    const p1 = keys[0];
    const pk = keys[keys.length - 1];
    const n = total;
    const sMin = Math.max(min, pk - n + 1);
    const sMax = Math.min(p1, max - n + 1);
    if (sMin <= sMax) return { ok: true, reason: '' };
    bestReason = 'الأوراق ليست متتالية بما يكفي لهذا العدد';
  }
  return { ok: false, reason: bestReason };
}

/** التحقق من نزول (سلسلة أو طقم) */
export function morValidate(cards: string[]): MorCheck {
  const list = [...cards];
  const n = list.length;
  if (n < 3) return { ok: false, kind: null, reason: 'النزول يحتاج ٣ أوراق على الأقل' };
  const wilds = list.filter(isMorWild);
  const naturals = list.filter((c) => !isMorWild(c));
  if (wilds.length > 2) return { ok: false, kind: null, reason: 'لا يُسمح بأكثر من مبدّلين (جوكر + ٢)' };
  const jokers = wilds.filter(isMorJoker).length;
  const twos = wilds.length - jokers;
  if (jokers > 1 || twos > 1) return { ok: false, kind: null, reason: 'الحد الأقصى جوكر واحد + ٢ واحد' };
  if (naturals.length < 1) return { ok: false, kind: null, reason: 'النزول لا يمكن أن يكون مبدّلات فقط' };
  if (validateSet(naturals, n).ok) return { ok: true, kind: 'set', reason: '' };
  const seq = validateSequence(naturals, n);
  if (seq.ok) return { ok: true, kind: 'seq', reason: '' };
  const set = validateSet(naturals, n);
  return { ok: false, kind: null, reason: seq.reason || set.reason };
}

/** نقاط المشروع (٠ إن كان أقل من ٧ أوراق) */
export function morMeldPoints(kind: MorMeldKind, cards: string[]): number {
  if (cards.length < 7) return 0;
  const wilds = cards.filter(isMorWild).length;
  if (kind === 'set') return wilds === 0 ? 300 : 150;
  return wilds === 0 ? 200 : 100;
}

/** هل يمكن للفريق الإغلاق؟ (٣٠٠ كاملة أو ٢٠٠ + ١٠٠) */
export function morCanClose(melds: MorMeld[]): boolean {
  const pts = melds.map((m) => m.points);
  const has300 = pts.includes(300);
  const has200 = pts.includes(200);
  const has100 = pts.includes(100);
  return has300 || (has200 && has100);
}

/** اسم مختصر للنزول */
export function morMeldLabel(meld: MorMeld): string {
  if (meld.kind === 'set') {
    const r = morRank(meld.cards.find((c) => !isMorWild(c)) ?? 'H3');
    return r === 14 ? 'طقم أصوص' : 'طقم ثلاثات';
  }
  return 'سلسلة';
}

/** تلميح المشروع بالعربية */
export function morProjectLabel(points: number): string {
  if (points === 300) return 'مشروع ٣٠٠';
  if (points === 200) return 'مشروع ٢٠٠';
  if (points === 150) return 'مشروع ١٥٠';
  if (points === 100) return 'مشروع ١٠٠';
  return '';
}
