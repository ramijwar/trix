import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { RoomState, TrixContract, TrixSummary } from '../game/types';
import {
  RANK_LABEL,
  SUITS,
  SUIT_SYMBOL,
  TRIX_CONTRACTS,
  TRIX_CONTRACT_AR,
  TRIX_CONTRACT_HINT,
  TRIX_CONTRACT_ICON,
  parseCard,
} from '../game/types';
import { cn, shareText } from '../lib/utils';
import { Avatar, Button, Modal } from './ui';
import { CardView } from './CardView';
import { GameTable } from './GameTable';
import { ChatDrawer } from './GamePanels';
import { keepScreenOn } from '../lib/native';
import type { RoomActions } from './GameView';

const CONTRACT_COLOR: Record<TrixContract, string> = {
  kbeh: 'from-rose-500/90 to-rose-700/90',
  queens: 'from-fuchsia-500/90 to-purple-700/90',
  diamonds: 'from-sky-500/90 to-cyan-700/90',
  tricks: 'from-amber-500/90 to-orange-700/90',
  trix: 'from-emerald-500/90 to-teal-700/90',
};

/** مجموعات أوراق تسمية التركس (تبدأ بالشاب وتمتد صعوداً ونزولاً) */
function Piles({ state, nameOf }: { state: RoomState; nameOf: (seat: number) => string }) {
  const piles = state.trix?.piles ?? {};
  const lastPlay = state.trix?.lastPlay ?? null;
  return (
    <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-black/55 p-2">
      {SUITS.map((suit) => {
        const pile = piles[suit];
        const cards: number[] = [];
        if (pile) {
          for (let r = pile.low; r <= pile.high; r++) cards.push(r);
        }
        return (
          <div key={suit} className="flex min-h-[46px] items-center gap-1 rounded-xl bg-white/5 px-1.5 py-1">
            <span className={cn('text-lg', suit === 'H' || suit === 'D' ? 'text-rose-400' : 'text-white')}>{SUIT_SYMBOL[suit]}</span>
            <div className="flex flex-row-reverse items-center" dir="ltr">
              {cards.length === 0 && <span className="text-[10px] text-ink-500">تبدأ بالشاب J</span>}
              {cards.map((r, i) => (
                <div key={r} className={cn(i > 0 && '-ml-3')}>
                  <CardView code={`${suit}${r}`} size="xs" />
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {lastPlay && (
        <div className="col-span-2 text-center text-[11px] font-bold text-gold-300">
          {nameOf(lastPlay.seat)} لعب {RANK_LABEL[parseCard(lastPlay.card).r]}
          {SUIT_SYMBOL[parseCard(lastPlay.card).s]}
        </div>
      )}
    </div>
  );
}

/** شريط نتائج اللاعبين الأربعة (لعبة فردية) */
function TrixScoreboard({ state }: { state: RoomState }) {
  const tx = state.trix!;
  const rows = useMemo(
    () =>
      state.seats
        .map((p, seat) => ({ p, seat, total: state.scores[seat] ?? 0, delta: tx.roundScores[seat] ?? 0 }))
        .filter((r) => r.p !== null)
        .sort((a, b) => b.total - a.total),
    [state.seats, state.scores, tx.roundScores],
  );
  return (
    <div className="no-scrollbar mx-2 mb-2 flex gap-2 overflow-x-auto">
      {rows.map((r, i) => (
        <motion.div
          key={r.seat}
          layout
          className={cn(
            'glass min-w-[104px] flex-1 rounded-2xl px-2 py-1.5',
            r.seat === state.mySeat && 'ring-2 ring-gold-400/70',
            r.seat === tx.kingSeat && 'ring-2 ring-sky-400/70',
          )}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-black text-ink-300">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '4'}</span>
            <Avatar emoji={r.p!.avatar} size={24} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-bold">
                {r.seat === tx.kingSeat && <span title="صاحب المملكة">👑 </span>}
                {r.p!.name}
              </div>
            </div>
          </div>
          <div className="mt-0.5 flex items-center justify-between">
            <span className="text-base font-black text-gold-300">{r.total}</span>
            <AnimatePresence>
              {r.delta !== 0 && (
                <motion.span
                  key={r.delta}
                  initial={{ scale: 1.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className={cn('text-[11px] font-bold', r.delta > 0 ? 'text-emerald-400' : 'text-rose-400')}
                >
                  {r.delta > 0 ? `+${r.delta}` : r.delta}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

/** نافذة اختيار التسمية — لصاحب المملكة فقط */
function ContractPicker({ state, onPick }: { state: RoomState; onPick: (c: TrixContract) => void }) {
  const tx = state.trix!;
  return (
    <Modal open onClose={() => {}} title="👑 اختيار التسمية">
      <p className="mb-3 text-xs leading-relaxed text-ink-300">
        أنت صاحب المملكة {tx.kingdom}/{tx.kingdoms} — اختر التسمية التي تريد لعبها الآن.
        الأقل ضرراً على يدك هو الأفضل، وبقيت لك {tx.legalContracts.length} تسميات.
      </p>
      <div className="grid gap-2">
        {TRIX_CONTRACTS.map((c) => {
          const used = tx.used.includes(c);
          const idx = TRIX_CONTRACTS.indexOf(c) + 1;
          const played = tx.used.length;
          return (
            <button
              key={c}
              disabled={used}
              onClick={() => onPick(c)}
              className={cn(
                'flex items-center gap-3 rounded-2xl border border-white/10 bg-gradient-to-l p-3 text-right transition',
                CONTRACT_COLOR[c],
                used ? 'opacity-40' : 'active:scale-[0.98] hover:brightness-110',
              )}
            >
              <span className="text-2xl">{TRIX_CONTRACT_ICON[c]}</span>
              <span className="flex-1">
                <span className="block text-sm font-black">{TRIX_CONTRACT_AR[c]}</span>
                <span className="block text-[11px] opacity-90">{TRIX_CONTRACT_HINT[c]}</span>
              </span>
              <span className="rounded-full bg-black/30 px-2 py-0.5 text-[10px] font-bold">
                {used ? 'لُعبت ✓' : `متاحة ${idx > played ? '' : ''}`}
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

/** نافذة الكشف/التدبيل قبل بدء التسمية */
function RevealPanel({ state, actions }: { state: RoomState; actions: RoomActions }) {
  const tx = state.trix!;
  const revealed = Object.keys(tx.revealed ?? {});
  return (
    <Modal open onClose={() => {}} title="🃏 فرصة التدبيل">
      <p className="mb-2 text-xs leading-relaxed text-ink-300">
        {tx.contract === 'kbeh'
          ? 'إن كنت تحمل K♥ يمكنك كشفه (تدبيله): من يأخذه يخسر 150 بدلاً من 75، وأنت تكسب 75 إن أخذه غيرك.'
          : 'إن كنت تحمل أي بنت (Q) يمكنك كشفها: من يأخذها يخسر 50 بدلاً من 25، وأنت تكسب 25 إن أخذها غيرك.'}
      </p>
      {revealed.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {revealed.map((card) => (
            <span key={card} className="rounded-full bg-rose-900/60 px-2 py-0.5 text-[11px] font-bold">
              مدبّلة: {RANK_LABEL[parseCard(card).r]}
              {SUIT_SYMBOL[parseCard(card).s]} — {state.seats[tx.revealed[card]]?.name ?? ''}
            </span>
          ))}
        </div>
      )}
      {tx.canReveal.length > 0 ? (
        <>
          <div className="mb-2 text-xs font-bold text-gold-300">أوراقك القابلة للتدبيل:</div>
          <div className="mb-3 flex justify-center gap-2" dir="ltr">
            {tx.canReveal.map((card) => (
              <button key={card} onClick={() => actions.reveal?.(card)} className="transition active:scale-95">
                <CardView code={card} size="md" className="ring-2 ring-gold-400/70" />
                <span className="mt-1 block text-center text-[10px] font-bold text-gold-300">اضغط للتدبيل</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="mb-3 text-center text-xs text-ink-400">لا تملك أوراقاً قابلة للتدبيل في هذه التسمية.</p>
      )}
      <Button variant="gold" full disabled={tx.revealReady} onClick={() => actions.reveal?.(undefined, true)}>
        {tx.revealReady ? '✅ في انتظار بقية اللاعبين…' : 'ابدأ اللعب الآن ▶'}
      </Button>
    </Modal>
  );
}

/** ملخص نهاية التسمية */
function DealSummary({ state, actions }: { state: RoomState; actions: RoomActions }) {
  const sum = state.lastRoundSummary as TrixSummary | null;
  if (!sum) return null;
  const tx = state.trix!;
  const rows = state.seats
    .map((p, seat) => ({ p, seat, delta: sum.roundScores[seat] ?? 0, total: sum.scores[seat] ?? 0 }))
    .filter((r) => r.p !== null)
    .sort((a, b) => (sum.contract === 'trix' ? (sum.finished.indexOf(a.seat) - sum.finished.indexOf(b.seat)) : a.delta - b.delta));
  return (
    <Modal open onClose={() => {}} title={`نتيجة ${sum.contractAr} — التوزيعة ${sum.dealNo}`}>
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={r.seat} className="flex items-center gap-2 rounded-xl bg-black/25 px-2 py-1.5">
            <span className="w-5 text-center text-sm font-black text-ink-300">{i + 1}</span>
            <Avatar emoji={r.p!.avatar} size={26} />
            <span className="flex-1 truncate text-sm font-bold">{r.p!.name}</span>
            {sum.contract === 'trix' && <span className="text-[11px] text-ink-300">أنهى أوراقه #{i + 1}</span>}
            <span className={cn('text-sm font-black', r.delta > 0 ? 'text-emerald-400' : r.delta < 0 ? 'text-rose-400' : 'text-ink-300')}>
              {r.delta > 0 ? `+${r.delta}` : r.delta}
            </span>
            <span className="w-12 text-left text-xs font-bold text-gold-300">{r.total}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 text-center text-xs text-ink-300">
        المملكة {sum.kingdom}/{tx.kingdoms} — بقيت {tx.legalContracts.length} تسميات في هذه المملكة
      </div>
      <Button variant="gold" full className="mt-3" onClick={() => actions.continueRound()}>
        التسمية التالية ▶
      </Button>
    </Modal>
  );
}

/** نهاية المباراة: الترتيب النهائي */
function TrixGameOver({ state, onExit, onRematch }: { state: RoomState; onExit: () => void; onRematch: () => void }) {
  const rows = state.seats
    .map((p, seat) => ({ p, seat, total: state.scores[seat] ?? 0 }))
    .filter((r) => r.p !== null)
    .sort((a, b) => b.total - a.total);
  const medals = ['🥇', '🥈', '🥉', '🎗️'];
  return (
    <Modal open onClose={onExit} title="انتهت مباراة التركس 🧩">
      <div className="space-y-2">
        {rows.map((r, i) => (
          <motion.div
            key={r.seat}
            initial={{ x: 30, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: i * 0.12 }}
            className={cn('flex items-center gap-2 rounded-2xl px-3 py-2', i === 0 ? 'bg-gold-500/25 ring-2 ring-gold-400/70' : 'bg-black/25')}
          >
            <span className="text-2xl">{medals[i]}</span>
            <Avatar emoji={r.p!.avatar} size={38} />
            <div className="flex-1">
              <div className="text-sm font-black">{r.p!.name}</div>
              <div className="text-[11px] text-ink-300">{r.seat === state.mySeat ? 'أنت' : `المقعد ${r.seat + 1}`}</div>
            </div>
            <span className="text-lg font-black text-gold-300">{r.total}</span>
          </motion.div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={onExit}>
          🚪 خروج
        </Button>
        <Button variant="gold" onClick={onRematch}>
          🔁 مباراة جديدة
        </Button>
      </div>
    </Modal>
  );
}

/* ============================ الواجهة الكاملة ============================ */
export function TrixView({
  state,
  actions,
  status = 'online',
  onExit,
}: {
  state: RoomState;
  actions: RoomActions;
  status?: 'connecting' | 'online' | 'offline';
  onExit: () => void;
}) {
  const [chatOpen, setChatOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const tx = state.trix;

  // إبقاء الشاشة مضاءة أثناء اللعب على الجوال
  useEffect(() => {
    keepScreenOn(true);
    return () => keepScreenOn(false);
  }, []);

  if (!tx) {
    return (
      <div className="screen-bg flex h-full items-center justify-center p-6 text-center text-sm text-ink-300">
        جارٍ تحميل طاولة التركس…
      </div>
    );
  }

  const nameOf = (seat: number) => state.seats[seat]?.name ?? `المقعد ${seat + 1}`;
  const contract = tx.contract;
  const isTrixContract = contract === 'trix';

  return (
    <div className="screen-bg flex h-full flex-col">
      {/* الرأس */}
      <header className="safe-top flex items-center justify-between px-3 pb-1 pt-2">
        <button onClick={onExit} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm">
          ← خروج
        </button>
        <div className="text-center">
          <div className="text-sm font-black">
            {state.roomName || 'طاولة'} <span className="text-emerald-300">• تركس</span>
          </div>
          <div className="text-[11px] text-ink-300">
            المملكة {tx.kingdom}/{tx.kingdoms} • التوزيعة {tx.dealNo} • 👑 {nameOf(tx.kingSeat)}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className={cn('size-2 rounded-full', status === 'online' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-500' : 'bg-rose-500')} />
          <button onClick={() => setChatOpen(true)} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm">
            💬
          </button>
          <button onClick={() => setMenuOpen(true)} className="rounded-2xl border border-white/10 bg-white/5 px-2 py-1.5 text-sm">
            ⋮
          </button>
        </div>
      </header>

      {/* شارة التسمية الحالية */}
      {contract && (
        <div className="mx-2 mb-1 flex items-center justify-between gap-2 rounded-2xl bg-black/40 px-3 py-1.5 text-xs">
          <span className="font-black">
            {TRIX_CONTRACT_ICON[contract]} {TRIX_CONTRACT_AR[contract]}
          </span>
          <span className="text-ink-300">{TRIX_CONTRACT_HINT[contract]}</span>
        </div>
      )}

      <TrixScoreboard state={state} />

      {/* الطاولة */}
      <GameTable
        state={state}
        onPlayCard={(code) => actions.play(code)}
        cardBack="blue"
        hideTrick={isTrixContract}
        badge={
          isTrixContract ? (
            <Piles state={state} nameOf={nameOf} />
          ) : contract && state.phase === 'playing' && state.trick.length === 0 ? (
            <div className="glass rounded-full px-3 py-1 text-xs font-bold text-ink-200">
              {TRIX_CONTRACT_ICON[contract]} {TRIX_CONTRACT_AR[contract]} — يفوز بالأكلة أعلى ورقة من اللون المطروح
            </div>
          ) : null
        }
        seatBadge={(seat) => {
          const left = state.handCounts[seat] ?? 0;
          const isKing = seat === tx.kingSeat;
          const finished = tx.finished.indexOf(seat);
          return (
            <span className="flex items-center gap-1">
              {isKing && <span className="rounded-full bg-sky-600/80 px-1.5 text-[9px] font-bold">👑 المملكة</span>}
              {finished >= 0 && <span className="rounded-full bg-emerald-700/80 px-1.5 text-[9px] font-bold">أنهى #{finished + 1}</span>}
              {isTrixContract && finished < 0 && <span className="rounded-full bg-black/40 px-1.5 text-[9px]">{left} ورقة</span>}
            </span>
          );
        }}
        footer={
          <span>
            أوراقك: {state.myHand.length} • أكلاتك: {tx.trickCounts[state.mySeat] ?? 0}
          </span>
        }
        hint={
          isTrixContract ? (
            state.isMyTurn && state.phase === 'playing' ? (
              <div className="mt-1 text-center text-xs text-gold-300">
                {state.legalCards.length > 0 ? 'العب ورقة ملاصقة لمجموعة أو ابدأ مجموعة بالشاب J' : 'لا تملك ورقة مناسبة — سيتم تمرير دورك'}
              </div>
            ) : null
          ) : state.phase === 'playing' && state.isMyTurn && state.trick.length > 0 ? (
            <div className="mt-1 text-center text-xs text-ink-300">
              {contract === 'diamonds' ? 'تجنّب أخذ الديناري 💎' : contract === 'queens' ? 'تجنّب أخذ البنات 👸' : contract === 'kbeh' ? 'تجنّب أخذ K♥ 👑' : 'تجنّب أخذ الأكلة 🎴'}
            </div>
          ) : null
        }
      />

      {/* اختيار التسمية */}
      {tx.mustChooseContract && <ContractPicker state={state} onPick={(c) => actions.chooseContract?.(c)} />}

      {/* الكشف/التدبيل */}
      {tx.revealPhase && !tx.mustChooseContract && <RevealPanel state={state} actions={actions} />}

      {/* انتظار اختيار الملك */}
      {!tx.mustChooseContract && !tx.contract && state.phase === 'choosing' && (
        <div className="mx-2 mb-2 rounded-2xl bg-black/40 py-2 text-center text-xs text-ink-200">
          👑 {nameOf(tx.kingSeat)} يختار التسمية… ({tx.used.length}/5 لُعبت في هذه المملكة)
        </div>
      )}

      {/* ملخص التسمية */}
      {state.phase === 'round_end' && <DealSummary state={state} actions={actions} />}

      {/* نهاية المباراة */}
      {state.phase === 'game_end' && (
        <TrixGameOver state={state} onExit={onExit} onRematch={() => actions.continueRound()} />
      )}

      <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} state={state} onSend={(t, e) => actions.chat(t, e)} />

      <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title="قائمة الطاولة">
        <div className="space-y-2">
          <Button variant="ghost" full onClick={() => void shareText(`انضم إليّ في طاولة التركس! رمز الغرفة: ${state.roomCode}`, 'طرنيب وتركس أونلاين')}>
            📤 دعوة صديق (مشاركة الرمز)
          </Button>
          <div className="rounded-2xl bg-black/25 p-3 text-xs leading-relaxed text-ink-300">
            <div className="mb-1 font-bold text-ink-100">قوانين التركس السريعة</div>
            • لعبة فردية: كل لاعب لنفسه، والفائز صاحب أعلى مجموع نقاط.
            <br />• كل لاعب يصبح «صاحب مملكة» مرة واحدة، ويختار فيها التسميات الخمس كلها.
            <br />• البنات −25 • الديناري −10 • اللطوش −15 • ختيار الكبة −75 • والتركس +200/+150/+100/+50.
            <br />• يجب اتباع اللون، ويمكن تدبيل (كشف) البنات وختيار الكبة قبل اللعب.
          </div>
          <Button variant="danger" full onClick={onExit}>
            🚪 الخروج من الطاولة
          </Button>
        </div>
      </Modal>

      {/* تنبيه انقطاع الاتصال */}
      {status === 'offline' && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-50 -translate-x-1/2 rounded-full bg-rose-600 px-3 py-1 text-xs font-bold">
          انقطع الاتصال — جارٍ إعادة المحاولة…
        </div>
      )}
    </div>
  );
}
