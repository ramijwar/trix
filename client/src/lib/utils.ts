import { SUIT_SYMBOL, RANK_LABEL, type Suit, type Card, parseCard } from '../game/types';

/** دمج الأصناف */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function suitSymbol(s: Suit): string {
  return SUIT_SYMBOL[s];
}

export function suitColor(s: Suit): string {
  return s === 'H' || s === 'D' ? 'text-rose-600' : 'text-slate-900';
}

export function cardRank(code: string): string {
  const c = parseCard(code);
  return RANK_LABEL[c.r] ?? String(c.r);
}

export function cardSuit(code: string): Suit {
  return parseCard(code).s;
}

export function isRedCard(code: string): boolean {
  const s = cardSuit(code);
  return s === 'H' || s === 'D';
}

export function sortHand(cards: Card[]): Card[] {
  const order: Record<string, number> = { S: 0, H: 1, D: 2, C: 3 };
  return [...cards].sort((a, b) => (order[a.s] - order[b.s]) || (b.r - a.r));
}

/** تنسيق رقم بفواصل */
export function fmt(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

/** الوقت المتبقي بصيغة mm:ss */
export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** الوقت النسبي (منذ ...) */
export function timeAgo(secondsAgo: number): string {
  if (secondsAgo < 60) return 'الآن';
  if (secondsAgo < 3600) return `قبل ${Math.floor(secondsAgo / 60)} دقيقة`;
  if (secondsAgo < 86400) return `قبل ${Math.floor(secondsAgo / 3600)} ساعة`;
  return `قبل ${Math.floor(secondsAgo / 86400)} يوم`;
}

export const TEAM_NAMES = ['الفريق الأزرق', 'الفريق البرتقالي'];
export const TEAM_COLORS = ['#38bdf8', '#fb923c'];

/** مقاعد الطاولة: 0 الأسفل (أنت)، 1 اليمين، 2 الأعلى (الشريك)، 3 اليسار */
export function relativeSeat(mySeat: number, seat: number): 0 | 1 | 2 | 3 {
  return (((seat - mySeat) % 4) + 4) % 4 as 0 | 1 | 2 | 3;
}

export function seatName(rel: number): string {
  return ['أنت', 'اليمين', 'الشريك', 'اليسار'][rel] ?? '';
}

/** اهتزاز الجهاز (غلاف الأندرويد أو Capacitor أو المتصفح) */
export async function vibrate(pattern: number | number[] = 18): Promise<void> {
  const { vibrateDevice } = await import('./native');
  await vibrateDevice(typeof pattern === 'number' ? pattern : 22);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** مشاركة نص: مشاركة النظام إن توفّرت، وإلا النسخ للحافظة */
export async function shareText(text: string, title = 'طرنيب وتركس أونلاين'): Promise<boolean> {
  try {
    if (navigator.share) {
      await navigator.share({ text, title });
      return true;
    }
  } catch {
    /* أُلغيت المشاركة */
  }
  const { copyText, nativeToast } = await import('./native');
  const done = await copyText(text);
  if (done) nativeToast('تم نسخ الرمز ✅');
  return done;
}
