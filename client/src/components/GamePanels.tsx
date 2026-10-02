import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import type { RoomState, RoundSummary as RoundSummaryData } from '../game/types';
import { SUIT_SYMBOL, type Suit } from '../game/types';
import { cn } from '../lib/utils';
import { Button, Modal } from './ui';
import { useStore } from '../lib/store';

/* ============================ شريط النقاط ============================ */
export function ScoreBar({ state }: { state: RoomState }) {
  const [a, b] = state.scores;
  const target = state.target || state.settings.target || 31;
  const pctA = Math.min(100, Math.max(0, (a / target) * 100));
  const pctB = Math.min(100, Math.max(0, (b / target) * 100));
  return (
    <div className="mx-2 mb-2 glass rounded-2xl px-3 py-2">
      <div className="flex items-center justify-between text-[11px] text-ink-300">
        <span>الجولة {Math.max(1, state.round)}</span>
        <span>الهدف {target} نقطة</span>
        <span>
          الأكلات {state.tricksWon?.[0] ?? 0} - {state.tricksWon?.[1] ?? 0}
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-2">
        {[
          { score: a, pct: pctA, color: '#38bdf8', name: 'فريقنا', team: 0 },
          { score: b, pct: pctB, color: '#fb923c', name: 'الخصوم', team: 1 },
        ]
          .sort((x, y) => (x.team === state.myTeam ? -1 : 1) - (y.team === state.myTeam ? -1 : 1))
          .map((t, i) => (
            <div key={i} className="rounded-xl bg-black/25 px-2 py-1.5">
              <div className="flex items-center justify-between text-xs font-bold" style={{ color: t.color }}>
                <span>{t.team === state.myTeam ? 'فريقك' : 'الفريق الخصم'}</span>
                <motion.span key={t.score} initial={{ scale: 1.4, color: '#fff' }} animate={{ scale: 1 }} className="text-base font-black">
                  {t.score}
                </motion.span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <motion.div className="h-full rounded-full" style={{ background: t.color }} animate={{ width: `${t.pct}%` }} transition={{ duration: 0.28 }} />
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

/* ============================ لوحة المزايدة ============================ */
export function BidPanel({
  state,
  onBid,
  onPass,
  onDouble,
  onTrump,
}: {
  state: RoomState;
  onBid: (v: number) => void;
  onPass: () => void;
  onDouble: () => void;
  onTrump: (s: Suit | 'NT') => void;
}) {
  const show = state.phase === 'bidding' && state.isMyTurn;
  const mustChooseTrump = Boolean(state.mustChooseTrump);
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key={mustChooseTrump ? 'trump' : 'bid'}
          initial={{ y: 120, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 120, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          className="glass absolute inset-x-2 bottom-2 z-40 rounded-3xl p-3 shadow-panel"
        >
          {mustChooseTrump ? (
            <>
              <div className="mb-2 text-center text-sm font-bold text-gold-300">فزت بالمزاد! اختر لون الطرنيب</div>
              <div className="grid grid-cols-4 gap-2">
                {suits.map((s) => (
                  <button
                    key={s}
                    onClick={() => onTrump(s)}
                    className={cn(
                      'flex h-16 flex-col items-center justify-center rounded-2xl border border-white/12 bg-white/8 text-3xl transition hover:bg-white/15 active:scale-95',
                      s === 'H' || s === 'D' ? 'text-rose-400' : 'text-white',
                    )}
                  >
                    {SUIT_SYMBOL[s]}
                  </button>
                ))}
              </div>
              {state.settings.allowNoTrump && (
                <Button variant="dark" full className="mt-2" onClick={() => onTrump('NT')}>
                  بدون طرنيب (NT)
                </Button>
              )}
            </>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-bold text-ink-100">
                  طلب فريقك: <span className="text-gold-300">7</span> على الأقل
                </span>
                {state.bid.value !== null && <span className="text-xs text-ink-300">أعلى طلب حالياً: {state.bid.value}</span>}
              </div>
              <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
                {state.legalBids.map((v) => (
                  <button
                    key={v}
                    onClick={() => onBid(v)}
                    className={cn(
                      'size-12 shrink-0 rounded-2xl text-lg font-black transition active:scale-95',
                      v === 13
                        ? 'bg-gradient-to-b from-rose-400 to-rose-600 text-white'
                        : 'bg-gradient-to-b from-gold-300 to-gold-600 text-felt-950',
                    )}
                  >
                    {v}
                  </button>
                ))}
                {!state.legalBids.length && <div className="px-2 py-3 text-sm text-ink-300">لا يمكنك الطلب — أعلى من 13</div>}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button variant="dark" onClick={onPass} disabled={!state.canPass}>
                  تمرير ✋
                </Button>
                <Button variant="danger" onClick={onDouble} disabled={!state.canDouble}>
                  مضاعفة ×2 🔥
                </Button>
              </div>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ============================ ملخص الجولة ============================ */
export function RoundSummary({ state, onContinue }: { state: RoomState; onContinue: () => void }) {
  // ملخص الجولة خاص بالطرنيب — التركس له ملخصه داخل TrixView
  const s = state.lastRoundSummary as RoundSummaryData | null;
  const show = state.phase === 'round_end' && Boolean(s);
  const [left, setLeft] = useState(3);
  useEffect(() => {
    if (!show) return;
    setLeft(3);
    const id = setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(id);
  }, [show, s?.round]);

  if (!s) return null;
  const myTeam = state.myTeam;
  const myDelta = s.delta[myTeam];
  const good = myDelta > 0;
  return (
    <Modal open={show} hideClose title={`نهاية الجولة ${s.round}`} maxWidth="max-w-sm">
      <div className="flex flex-col items-center gap-3">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={cn('flex size-20 items-center justify-center rounded-full text-4xl', good ? 'bg-emerald-500/20' : 'bg-rose-500/20')}
        >
          {s.kaboot ? '👑' : good ? '🎉' : '😅'}
        </motion.div>
        <div className="text-center">
          <div className="text-lg font-bold">
            {s.made ? 'نجح الطلب' : 'فشل الطلب'} — {s.bid} أكلات
          </div>
          <div className="mt-1 text-sm text-ink-300">
            فريق الطلب أخذ <span className="font-bold text-ink-100">{s.teamTricks}</span> أكلة
            {s.doubled && ' (مضاعف)'}
            {s.kaboot && ' — كبوت!'}
          </div>
        </div>

        <div className="grid w-full grid-cols-2 gap-2">
          <div className={cn('rounded-2xl px-3 py-2 text-center', s.team === 0 ? 'bg-sky-500/15' : 'bg-orange-500/15')}>
            <div className="text-xs text-ink-300">فريق الطلب</div>
            <div className={cn('text-xl font-black', s.delta[s.team] >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
              {s.delta[s.team] >= 0 ? '+' : ''}
              {s.delta[s.team]}
            </div>
          </div>
          <div className={cn('rounded-2xl px-3 py-2 text-center', s.team === 1 ? 'bg-sky-500/15' : 'bg-orange-500/15')}>
            <div className="text-xs text-ink-300">الفريق المدافع</div>
            <div className={cn('text-xl font-black', s.delta[s.team === 0 ? 1 : 0] >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
              {s.delta[s.team === 0 ? 1 : 0] >= 0 ? '+' : ''}
              {s.delta[s.team === 0 ? 1 : 0]}
            </div>
          </div>
        </div>

        <div className="flex w-full items-center justify-between rounded-2xl bg-black/25 px-4 py-2 text-sm">
          <span className="text-ink-300">المجموع</span>
          <span className="font-black">
            <span className="text-sky-400">{s.scores[0]}</span> — <span className="text-orange-400">{s.scores[1]}</span>
          </span>
          <span className="text-ink-300">الهدف {state.target}</span>
        </div>

        <Button variant="gold" full onClick={onContinue}>
          الجولة التالية ({left})
        </Button>
      </div>
    </Modal>
  );
}

/* ============================ نهاية المباراة ============================ */
export function GameOver({ state, onExit, onRematch }: { state: RoomState; onExit: () => void; onRematch: () => void }) {
  const user = useStore((st) => st.user);
  const won = state.winnerTeam === state.myTeam;
  const show = state.phase === 'game_end';
  const [a, b] = state.scores;
  return (
    <Modal open={show} hideClose title={won ? 'فزتم بالمباراة! 🏆' : 'خسرنا هذه المرة'} maxWidth="max-w-sm">
      <div className="flex flex-col items-center gap-4">
        <motion.div initial={{ scale: 0.4, rotate: -15 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300 }} className="text-6xl">
          {won ? '🏆' : '🤝'}
        </motion.div>
        <div className="flex w-full items-center justify-around rounded-2xl bg-black/25 py-3">
          <div className="text-center">
            <div className="text-xs text-sky-400">الفريق الأزرق</div>
            <div className="text-3xl font-black" style={{ color: state.winnerTeam === 0 ? '#22c55e' : '#e5e7eb' }}>
              {a}
            </div>
          </div>
          <div className="text-ink-500">—</div>
          <div className="text-center">
            <div className="text-xs text-orange-400">الفريق البرتقالي</div>
            <div className="text-3xl font-black" style={{ color: state.winnerTeam === 1 ? '#22c55e' : '#e5e7eb' }}>
              {b}
            </div>
          </div>
        </div>
        <div className="text-center text-sm text-ink-300">
          عدد الجولات: {Math.max(1, state.round - 1)}
          {user && <div className="mt-1">رصيدك: 🪙 {user.coins} • مستوى {user.level}</div>}
        </div>
        <div className="grid w-full grid-cols-2 gap-2">
          <Button variant="gold" onClick={onRematch}>
            مباراة جديدة
          </Button>
          <Button variant="dark" onClick={onExit}>
            الخروج للردهة
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ============================ الشات ============================ */
export const QUICK_PHRASES = [
  'يلا بينا 💪',
  'ورق حلو 🍀',
  'برافو 👏',
  'شكراً شركاء 🙏',
  'ركّز معي 😅',
  'هههه 😄',
  'كبوت إن شاء الله 🔥',
  'معليش، الجاية أحسن',
  'دورك 🙌',
  'الله يعين 😩',
];

export function ChatDrawer({
  open,
  onClose,
  state,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  state: RoomState;
  onSend: (text: string, emoji?: string) => void;
}) {
  const [text, setText] = useState('');
  const messages = useMemo(() => (state.chat ?? []).slice(-40), [state.chat]);
  const emojis = ['👍', '😂', '😮', '🔥', '😎', '🙏', '👏', '😭'];
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="glass fixed inset-x-0 bottom-0 z-50 flex max-h-[75vh] flex-col rounded-t-3xl p-3"
            initial={{ y: 400 }}
            animate={{ y: 0 }}
            exit={{ y: 400 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-bold">الدردشة</span>
              <button onClick={onClose} className="rounded-xl px-2 py-1 text-ink-300 hover:bg-white/10">
                ✕
              </button>
            </div>
            <div className="mb-2 flex-1 overflow-y-auto rounded-2xl bg-black/25 p-2">
              {messages.length === 0 && <div className="py-6 text-center text-sm text-ink-300">لا رسائل بعد — قل مرحباً 👋</div>}
              {messages.map((m) => (
                <div key={m.id} className={cn('mb-1.5 flex', m.seat === state.mySeat ? 'justify-start' : 'justify-end')}>
                  <div className={cn('max-w-[80%] rounded-2xl px-3 py-1.5 text-sm', m.seat === null ? 'bg-white/10 text-ink-300' : m.seat === state.mySeat ? 'bg-gold-500/25' : 'bg-white/12')}>
                    {m.seat !== state.mySeat && m.seat !== null && <div className="text-[10px] text-ink-300">{m.name}</div>}
                    <div>{m.text}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mb-2 flex gap-1 overflow-x-auto no-scrollbar">
              {emojis.map((e) => (
                <button key={e} onClick={() => onSend(e, e)} className="shrink-0 rounded-xl bg-white/8 px-2 py-1 text-xl active:scale-90">
                  {e}
                </button>
              ))}
            </div>
            <div className="mb-2 grid grid-cols-2 gap-1.5">
              {QUICK_PHRASES.slice(0, 6).map((p) => (
                <button key={p} onClick={() => onSend(p)} className="rounded-xl bg-white/8 px-2 py-1.5 text-xs active:scale-95">
                  {p}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && text.trim()) {
                    onSend(text.trim());
                    setText('');
                  }
                }}
                placeholder="اكتب رسالة…"
                className="flex-1 rounded-2xl border border-white/12 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-ink-500"
              />
              <Button
                variant="gold"
                size="sm"
                onClick={() => {
                  if (text.trim()) {
                    onSend(text.trim());
                    setText('');
                  }
                }}
              >
                إرسال
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
