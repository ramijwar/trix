import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import type { RoomState, SeatPlayer } from '../game/types';
import { SUIT_SYMBOL, TEAM_OF_SEAT, type Suit } from '../game/types';
import { cn, relativeSeat } from '../lib/utils';
import { Avatar } from './ui';
import { CardStack, CardView } from './CardView';

/* ============================== مؤقت الدور ============================== */
function useCountdown(deadlineMs: number | null, tick = 250): number {
  const target = useMemo(() => (deadlineMs ? Date.now() + deadlineMs : null), [deadlineMs]);
  const [left, setLeft] = useState<number>(deadlineMs ?? 0);
  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setLeft(Math.max(0, target - Date.now())), tick);
    return () => clearInterval(id);
  }, [target, tick]);
  return left;
}

function TimerRing({ until }: { until: number | null }) {
  const left = useCountdown(until);
  if (until === null) return null;
  const total = Math.max(1000, until);
  const pct = Math.max(0, Math.min(1, left / total));
  const danger = left < 6000;
  return (
    <div
      className="pointer-events-none absolute -inset-1.5 rounded-full"
      style={{
        background: `conic-gradient(${danger ? '#ef4444' : '#d4af37'} ${pct * 360}deg, rgba(255,255,255,.12) 0deg)`,
        mask: 'radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3px))',
        WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3px))',
      }}
    />
  );
}

/* ============================== مقعد لاعب ============================== */
const POS: Record<number, string> = {
  0: 'bottom-0 left-1/2 -translate-x-1/2',
  1: 'right-2 top-1/2 -translate-y-1/2',
  2: 'top-1 left-1/2 -translate-x-1/2',
  3: 'left-2 top-1/2 -translate-y-1/2',
};

interface SeatProps {
  player: SeatPlayer | null;
  rel: 0 | 1 | 2 | 3;
  isTurn: boolean;
  isDealer: boolean;
  handCount: number;
  bid: number | null;
  passed: boolean;
  bestBid: number | null;
  cardBack: string;
  deadline: number | null;
  badge?: React.ReactNode;
}

/** صف أفقي من أوراق الظهر — يُستخدم لمقعد الشريك في الأعلى حتى لا تمتد الأوراق لوسط الطاولة */
function CardRow({ count, back = 'red' }: { count: number; back?: string }) {
  const shown = Math.min(count, 10);
  return (
    <div className="flex flex-col items-center">
      <div className="flex flex-row items-center justify-center" dir="ltr">
        {Array.from({ length: shown }, (_, i) => (
          <div
            key={i}
            className={cn('playing-card card-back shrink-0', back, 'rounded-[4px]')}
            style={{ width: 18, height: 26, marginLeft: i === 0 ? 0 : -9, transform: `rotate(${(i - (shown - 1) / 2) * 2.2}deg)` }}
          />
        ))}
      </div>
      <div className="text-[11px] font-bold text-ink-300">{count} ورقة</div>
    </div>
  );
}

function Seat({ player, rel, isTurn, isDealer, handCount, bid, passed, bestBid, cardBack, deadline, badge }: SeatProps) {
  const teamColor = player ? (TEAM_OF_SEAT[player.seat] === 0 ? '#38bdf8' : '#fb923c') : '#94a3b8';
  const vertical = rel === 1 || rel === 3;
  return (
    <div
      className={cn(
        'absolute z-20 flex items-center gap-1',
        // المقعد العلوي (الشريك): الترتيب من الأعلى للأسفل المقلوب حتى تبقى أوراقه بعيدة عن مركز الطاولة
        rel === 2 ? 'flex-col-reverse' : 'flex-col',
        POS[rel],
        vertical ? 'max-w-[96px]' : 'max-w-[170px]',
      )}
    >
      <div className="relative">
        <Avatar emoji={player?.avatar ?? '🪑'} size={52} frame={player?.isBot ? 'gold' : null} />
        {isTurn && <TimerRing until={deadline} />}
        {isDealer && (
          <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-white text-[10px] font-black text-felt-950 shadow">
            D
          </span>
        )}
        {player && !player.connected && !player.isBot && (
          <span className="absolute -bottom-1 -left-2 rounded-full bg-rose-600 px-1.5 text-[9px] font-bold">منقطع</span>
        )}
        {player?.isBot && <span className="absolute -bottom-1 -left-2 rounded-full bg-slate-700 px-1.5 text-[9px] font-bold">بوت</span>}
      </div>

      <div className="w-full rounded-xl bg-black/40 px-2 py-0.5 text-center backdrop-blur">
        <div className="truncate text-[11px] font-bold" style={{ color: teamColor }}>
          {player?.name ?? 'مقعد فارغ'}
        </div>
        {player && <div className="text-[9px] text-ink-300">مستوى {player.level}</div>}
      </div>

      <div className="flex items-center gap-1">
        {bid !== null && (
          <span className={cn('rounded-full px-2 text-[11px] font-extrabold', bestBid === bid ? 'bg-gold-500 text-felt-950' : 'bg-white/15')}>{bid}</span>
        )}
        {passed && <span className="rounded-full bg-rose-900/80 px-2 text-[10px] font-bold text-rose-200">مرّر</span>}
        {badge}
      </div>

      {handCount > 0 &&
        (rel === 2 ? (
          <CardRow count={handCount} back={cardBack} />
        ) : (
          <div className="scale-[0.85]">
            <CardStack count={handCount} back={cardBack} size="xs" />
          </div>
        ))}
    </div>
  );
}

/* ============================== الطاولة ============================== */
const TRICK_POS: Record<number, string> = {
  0: 'left-1/2 -translate-x-1/2 bottom-[15%]',
  1: 'right-[19%] top-1/2 -translate-y-1/2',
  2: 'left-1/2 -translate-x-1/2 top-[14%]',
  3: 'left-[19%] top-1/2 -translate-y-1/2',
};

interface TableProps {
  state: RoomState;
  onPlayCard: (code: string) => void;
  cardBack: string;
  shake?: boolean;
  children?: React.ReactNode;
  /** شارة وسط الطاولة (تُستخدم في التركس لعرض التسمية) بدل شارة الطرنيب */
  badge?: React.ReactNode;
  /** شارة أسفل كل مقعد (بدل الطلبات والتمرير) */
  seatBadge?: (seat: number) => React.ReactNode;
  /** سطر التلميح أسفل اليد */
  hint?: React.ReactNode;
  /** سطر معلومات فوق اليد */
  footer?: React.ReactNode;
  /** إخفاء أوراق الأكلة في الوسط (لأن التركس يعرض المجموعات) */
  hideTrick?: boolean;
}

export function GameTable({ state, onPlayCard, cardBack, shake, children, badge, seatBadge, hint, footer, hideTrick }: TableProps) {
  const mySeat = state.mySeat;
  const relOf = (seat: number) => relativeSeat(mySeat, seat) as 0 | 1 | 2 | 3;
  const turnDeadline =
    state.phase === 'bidding' || state.phase === 'playing' || state.phase === 'choosing' || state.phase === 'reveal' ? state.deadline : null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col px-2">
      <div className={cn('felt-table relative min-h-[280px] flex-1 overflow-hidden rounded-[2rem]', shake && 'anim-shake')}>
        <div className="pointer-events-none absolute inset-3 rounded-[1.7rem] border border-gold-500/20" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.14] [background:repeating-linear-gradient(45deg,rgba(255,255,255,.06)_0_2px,transparent_2px_6px)]" />

        {/* شارات الوسط */}
        <div className="absolute left-1/2 top-1/2 z-[5] flex max-w-[92%] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
          {badge}
          <AnimatePresence>
            {state.trump && (
              <motion.div
                key={state.trump}
                initial={{ scale: 0.4, opacity: 0, rotate: -12 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                exit={{ opacity: 0 }}
                className="glass flex items-center gap-2 rounded-full px-3 py-1 text-sm font-bold shadow-panel"
              >
                <span className="text-ink-300">الطرنيب</span>
                <span className={cn('text-xl', state.trump === 'H' || state.trump === 'D' ? 'text-rose-400' : 'text-white')}>
                  {state.trump === 'NT' ? '🚫' : SUIT_SYMBOL[state.trump as Suit]}
                </span>
                {state.bid.doubled && <span className="rounded-full bg-rose-600 px-2 text-[11px] font-extrabold">مضاعف ×2</span>}
              </motion.div>
            )}
            {!state.trump && state.bid.value !== null && (
              <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass rounded-full px-3 py-1 text-sm font-bold">
                أعلى طلب: <span className="text-gold-300">{state.bid.value}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* أوراق الأكلة */}
        <div className={cn('absolute inset-0 z-10', hideTrick && 'hidden')}>
          <AnimatePresence>
            {state.trick.map((tc) => (
              <motion.div
                key={tc.card + '-' + tc.seat}
                className={cn('absolute', TRICK_POS[relOf(tc.seat)])}
                initial={{ scale: 0.5, opacity: 0, y: 26 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 26 }}
              >
                <CardView code={tc.card} size="md" />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* المقاعد */}
        {[0, 1, 2, 3].map((seat) => {
          if (seat === mySeat) return null;
          return (
            <Seat
              key={seat}
              player={state.seats[seat]}
              rel={relOf(seat)}
              isTurn={state.turn === seat && (state.phase === 'bidding' || state.phase === 'playing')}
              isDealer={state.dealer === seat}
              handCount={state.handCounts[seat] ?? 0}
              bid={seatBadge ? null : state.roundBids?.[seat] ?? null}
              passed={seatBadge ? false : (state.bid.passed ?? []).includes(seat)}
              bestBid={state.bid.value}
              cardBack={cardBack}
              deadline={turnDeadline}
              badge={seatBadge ? seatBadge(seat) : null}
            />
          );
        })}

        {children}
      </div>

      {/* منطقة أوراقي */}
      <div className="relative mt-2">
        <div className="mb-1 flex items-center justify-between px-2 text-[11px] text-ink-300">
          {footer ?? (
            <span>
              أوراقك: {state.myHand.length}
              {' • '}أكلات فريقك: {state.tricksWon[state.myTeam]}
            </span>
          )}
          {state.isMyTurn && (state.phase === 'playing' || state.phase === 'choosing') && <span className="font-bold text-gold-300">دورك الآن</span>}
          {!state.isMyTurn && (state.phase === 'bidding' || state.phase === 'playing') && (
            <span className="truncate">{(state.seats[state.turn]?.name ?? '') + ' يفكر…'}</span>
          )}
        </div>
        <div className="no-scrollbar flex items-end overflow-x-auto px-1 pb-1" dir="rtl">
          {state.myHand.map((c, i) => {
            const legal = !state.isMyTurn || state.legalCards.includes(c);
            const playable = state.isMyTurn && state.phase === 'playing' && legal;
            return (
              <motion.div
                key={c}
                layout
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: Math.min(i * 0.02, 0.25), type: 'spring', stiffness: 380, damping: 30 }}
                className={cn('shrink-0', i > 0 && '-mr-3')}
              >
                <CardView
                  code={c}
                  size="md"
                  dim={state.isMyTurn && state.phase === 'playing' && !legal}
                  onClick={playable ? () => onPlayCard(c) : undefined}
                  className={cn(playable && 'hover:-translate-y-2')}
                />
              </motion.div>
            );
          })}
        </div>
        {hint ??
          (state.phase === 'playing' && state.isMyTurn && state.trick.length > 0 ? (
            <div className="mt-1 text-center text-xs text-ink-300">اختر ورقة — يجب اتباع اللون إن كان متاحاً</div>
          ) : null)}
      </div>
    </div>
  );
}
