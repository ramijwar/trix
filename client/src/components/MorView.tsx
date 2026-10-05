/**
 * واجهة لعبة المور (MOR) — ٤ لاعبين، فريقان متقابلان
 * ------------------------------------------------------------------
 * • الطاولة: الرزمة + كومة الرمي + كومتا المور + نزولات الفريقين
 * • اليد: اختيار متعدد باللمس ثم نزول/إضافة، أو اختيار ورقة واحدة للرمي
 * • تلميحات فورية: صلاحية النزول، نقاط المشروع، شرط ٣٠٠ للإغلاق
 */
import { useMemo, useState } from 'react';
import type { RoomState } from '../game/types';
import { MOR_MODE_AR, morMeldLabel, morMeldPoints, morProjectLabel, morValidate, type MorMeld } from '../game/mor';
import { cn } from '../lib/utils';
import { Avatar, Button, Modal, SectionTitle } from './ui';
import { CardView } from './CardView';
import { ChatDrawer } from './GamePanels';
import type { RoomActions } from './GameView';

/* ============================ بطاقة صغيرة للمنضدة ============================ */

function TableCards({ cards, size = 'xs', highlight }: { cards: string[]; size?: 'xs' | 'sm'; highlight?: boolean }) {
  return (
    <div className="flex flex-wrap items-end gap-0.5">
      {cards.map((c, i) => (
        <CardView key={`${c}-${i}`} code={c} size={size} glow={highlight} />
      ))}
    </div>
  );
}

/* ============================ صف نزول فريق ============================ */

function MeldRow({ melds, mine, onPick }: { melds: MorMeld[]; mine?: boolean; onPick?: (meld: MorMeld) => void }) {
  if (melds.length === 0) {
    return <div className="text-[11px] text-ink-500">{mine ? 'لم تنزل بعد — أول نزول يحتاج ٣ أوراق' : 'لم ينزل الخصم بعد'}</div>;
  }
  return (
    <div className="flex flex-wrap items-start gap-1.5">
      {melds.map((m) => (
        <button
          key={m.id}
          onClick={() => onPick?.(m)}
          disabled={!onPick}
          className={cn(
            'rounded-xl border p-1 text-right',
            m.project ? 'border-gold-400/70 bg-gold-500/10' : 'border-white/10 bg-black/25',
            onPick && 'active:scale-95',
          )}
        >
          <div className="mb-0.5 flex items-center gap-1 px-0.5 text-[9px] leading-none">
            <span className="font-bold text-ink-200">{morMeldLabel(m)}</span>
            <span className="text-ink-500">{m.count} ورق</span>
            {m.project && <span className="rounded-full bg-gold-500 px-1 font-black text-felt-950">{m.points}</span>}
            {m.project && m.clean && <span className="text-emerald-300">نظيف</span>}
          </div>
          <TableCards cards={m.cards} />
        </button>
      ))}
    </div>
  );
}

/* ============================ الطاولة ============================ */

export function MorView({
  state,
  actions,
  status,
  onExit,
}: {
  state: RoomState;
  actions: RoomActions;
  status: 'connecting' | 'online' | 'offline';
  onExit: () => void;
}) {
  const mor = state.mor;
  const [selIdx, setSelIdx] = useState<number[]>([]);
  const [addTarget, setAddTarget] = useState<number | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hint, setHint] = useState('');

  const myTeam = (state.mySeat % 2) as 0 | 1;
  const oppTeam = (1 - myTeam) as 0 | 1;
  const myMelds = mor?.melds?.[myTeam] ?? [];
  const oppMelds = mor?.melds?.[oppTeam] ?? [];
  const hand = state.myHand ?? [];

  /** الأوراق المختارة (نرسل الرموز للخادم — والتكرار مسموح) */
  const selected = useMemo(() => selIdx.map((i) => hand[i]).filter(Boolean), [selIdx, hand]);
  const selectionCheck = useMemo(() => (selected.length ? morValidate(selected) : null), [selected]);
  const selectedPoints = useMemo(
    () => (selectionCheck?.ok && selectionCheck.kind ? morMeldPoints(selectionCheck.kind, selected) : 0),
    [selectionCheck, selected],
  );

  const toggle = (index: number) => {
    setAddTarget(null);
    setHint('');
    setSelIdx((prev) => (prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index].sort((a, b) => a - b)));
  };

  const clear = () => {
    setSelIdx([]);
    setAddTarget(null);
    setHint('');
  };

  const doMeld = () => {
    if (!selectionCheck?.ok) {
      setHint(selectionCheck?.reason ?? 'اختر ٣ أوراق على الأقل');
      return;
    }
    actions.morMeld?.(selected);
    clear();
  };

  const doAdd = () => {
    if (addTarget === null) {
      setHint('اختر النزول الذي تريد الإضافة إليه بالضغط عليه');
      return;
    }
    if (selected.length === 0) {
      setHint('اختر ورقة أو أكثر من يدك');
      return;
    }
    const meld = myMelds.find((m) => m.id === addTarget);
    if (meld) {
      const check = morValidate([...meld.cards, ...selected]);
      if (!check.ok) {
        setHint(check.reason);
        return;
      }
    }
    actions.morAdd?.(addTarget, selected);
    clear();
  };

  const doDiscard = () => {
    if (selected.length !== 1) {
      setHint('اختر ورقة واحدة لرميها');
      return;
    }
    actions.morDiscard?.(selected[0]);
    clear();
  };

  const deadline = state.deadline;
  const secondsLeft = deadline != null ? Math.max(0, Math.ceil(deadline / 1000)) : null;
  const myTurn = Boolean(state.isMyTurn) && state.phase === 'playing';

  /* ---------- نهاية الدور / المباراة ---------- */
  const summary = state.lastRoundSummary as
    | {
        reason?: string;
        winnerTeam?: number | null;
        deltas?: number[];
        projects?: number[];
        morTaken?: boolean[];
        round?: number;
      }
    | null
    | undefined;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 px-2 pt-2">
        <div className="flex items-center gap-2">
          <button onClick={onExit} className="rounded-xl border border-white/10 bg-white/5 px-2 py-1 text-xs">
            ← خروج
          </button>
          <span className="rounded-full bg-fuchsia-700/60 px-2 py-0.5 text-[10px] font-black">مور 🀄</span>
          {mor && (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px]">
              {MOR_MODE_AR[mor.mode]} • الهدف {state.target}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', status === 'online' ? 'bg-emerald-600' : 'bg-amber-600')}>
            {status === 'online' ? 'متصل' : status === 'connecting' ? 'جارٍ الاتصال' : 'انقطع'}
          </span>
          <button onClick={() => setRulesOpen(true)} className="rounded-2xl border border-white/10 bg-white/5 px-2 py-1 text-sm">
            ❔
          </button>
          <button onClick={() => setChatOpen(true)} className="rounded-2xl border border-white/10 bg-white/5 px-2 py-1 text-sm">
            💬
          </button>
          <button onClick={() => setMenuOpen(true)} className="rounded-2xl border border-white/10 bg-white/5 px-2 py-1 text-sm">
            ☰
          </button>
        </div>
      </header>

      {/* شريط النتائج */}
      <div className="mx-2 mt-2 grid grid-cols-2 gap-2">
        {[myTeam, oppTeam].map((team) => {
          const isMine = team === myTeam;
          return (
            <div key={team} className={cn('rounded-2xl px-3 py-2', isMine ? 'bg-emerald-900/40 ring-1 ring-emerald-500/40' : 'bg-black/35')}>
              <div className="flex items-center justify-between">
                <span className={cn('text-[11px] font-black', isMine ? 'text-emerald-300' : 'text-ink-300')}>
                  {isMine ? 'فريقنا' : 'فريقهم'}
                </span>
                <span className="text-lg font-black text-gold-300">{state.scores[team] ?? 0}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-300">
                <span>مشاريع: {mor?.teamProjects?.[team] ?? 0}</span>
                <span>{mor?.morTaken?.[team] ? '✔ أخذوا المور' : '— لم يأخذوا المور'}</span>
                {mor?.canClose?.[team] && <span className="rounded-full bg-gold-500 px-1 font-black text-felt-950">جاهز للإغلاق</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* الطاولة */}
      <div className="relative mt-2 flex-1 overflow-y-auto px-2">
        <div className="rounded-3xl bg-felt-900/50 p-2 ring-1 ring-white/5">
          {/* المنافس في الأعلى */}
          <SeatStrip state={state} team={oppTeam} myTeam={myTeam} />

          {/* المنتصف: الرزمة + الرمي + المور */}
          <div className="my-2 grid grid-cols-3 items-center gap-2">
            <button
              onClick={() => myTurn && mor?.needDraw && actions.morDraw?.('deck')}
              disabled={!myTurn || !mor?.needDraw}
              className={cn(
                'flex flex-col items-center justify-center rounded-2xl border px-2 py-2',
                myTurn && mor?.needDraw ? 'border-gold-400/70 bg-gold-500/10' : 'border-white/10 bg-black/25',
              )}
            >
              <div className="relative">
                <CardView code="S14" size="sm" faceDown />
                <span className="absolute -bottom-1 -left-1 rounded-full bg-black/80 px-1.5 text-[10px] font-bold">{mor?.deckCount ?? 0}</span>
              </div>
              <span className="mt-1 text-[10px] font-bold">{myTurn && mor?.needDraw ? 'اسحب من الرزمة' : 'الرزمة'}</span>
            </button>

            <button
              onClick={() => myTurn && mor?.needDraw && mor.canTakePile && actions.morDraw?.('pile')}
              disabled={!myTurn || !mor?.needDraw || !mor?.canTakePile}
              className={cn(
                'flex flex-col items-center justify-center rounded-2xl border px-2 py-2',
                myTurn && mor?.needDraw && mor?.canTakePile ? 'border-sky-400/70 bg-sky-500/10' : 'border-white/10 bg-black/25',
              )}
            >
              {mor?.discardTop ? <CardView code={mor.discardTop} size="sm" /> : <div className="h-16 w-11 rounded-md border border-dashed border-white/20" />}
              <span className="mt-1 text-[10px] font-bold">كومة الرمي ({mor?.discardCount ?? 0})</span>
              {mor?.canTakePile && <span className="text-[9px] text-sky-300">خُذها كاملة</span>}
            </button>

            <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-black/25 px-2 py-2">
              <div className="flex gap-1">
                {[0, 1].map((t) => (
                  <div
                    key={t}
                    className={cn(
                      'flex h-16 w-11 flex-col items-center justify-center rounded-md border text-[10px] font-black',
                      (mor?.morCounts?.[t] ?? 0) > 0 ? 'border-fuchsia-400/60 bg-fuchsia-900/30 text-fuchsia-200' : 'border-white/15 text-ink-500',
                    )}
                  >
                    <span>🀄</span>
                    <span>{mor?.morCounts?.[t] ?? 0}</span>
                  </div>
                ))}
              </div>
              <span className="mt-1 text-[10px] font-bold">كومتا المور</span>
              {myTurn && mor?.canTakeMor && (
                <button onClick={() => actions.morTakeMor?.()} className="mt-1 rounded-lg bg-fuchsia-600 px-2 py-0.5 text-[10px] font-bold">
                  خُذ المور
                </button>
              )}
            </div>
          </div>

          {/* نزولات الفريقين */}
          <div className="space-y-2">
            <div className="rounded-2xl bg-black/25 p-2">
              <div className="mb-1 flex items-center justify-between text-[10px] font-bold text-emerald-300">
                <span>نزولات فريقنا {addTarget !== null && <span className="text-gold-300">— اخترت نزولاً للإضافة</span>}</span>
                <span>{mor?.teamProjects?.[myTeam] ?? 0} نقطة مشاريع</span>
              </div>
              <MeldRow melds={myMelds} mine onPick={(m) => setAddTarget(m.id === addTarget ? null : m.id)} />
            </div>
            <div className="rounded-2xl bg-black/20 p-2">
              <div className="mb-1 flex items-center justify-between text-[10px] font-bold text-ink-300">
                <span>نزولات الخصم</span>
                <span>{mor?.teamProjects?.[oppTeam] ?? 0} نقطة مشاريع</span>
              </div>
              <MeldRow melds={oppMelds} mine={false} />
            </div>
          </div>

          <div className="mt-2">
            <SeatStrip state={state} team={myTeam} myTeam={myTeam} compact />
          </div>
        </div>

        {/* ملخص الدور */}
        {state.phase !== 'playing' && summary && (
          <div className="mt-2 rounded-2xl bg-black/40 p-3 ring-1 ring-white/10">
            <SectionTitle icon={<span>📋</span>}>{state.phase === 'game_end' ? 'انتهت المباراة' : 'انتهت اللقطة'}</SectionTitle>
            <div className="space-y-1 text-xs">
              <div>
                {summary.reason === 'deck_out'
                  ? 'نفدت الرزمة — لا فائز في هذه اللقطة'
                  : summary.winnerTeam === myTeam
                    ? 'فريقنا أغلق اللقطة 🎉'
                    : 'فريقهم أغلق اللقطة'}
              </div>
              <div className="text-ink-300">
                مشاريعنا {(summary.projects ?? [0, 0])[myTeam]} • مشاريعهم {(summary.projects ?? [0, 0])[oppTeam]}
              </div>
              <div className="text-ink-300">
                تغيّر النقاط: فريقنا {(summary.deltas ?? [0, 0])[myTeam] >= 0 ? '+' : ''}
                {(summary.deltas ?? [0, 0])[myTeam]} • فريقهم {(summary.deltas ?? [0, 0])[oppTeam] >= 0 ? '+' : ''}
                {(summary.deltas ?? [0, 0])[oppTeam]}
              </div>
              {state.phase === 'game_end' ? (
                <Button variant="gold" full className="mt-2" onClick={onExit}>
                  الخروج للردهة
                </Button>
              ) : (
                <Button variant="gold" full className="mt-2" onClick={() => actions.continueRound()}>
                  اللقطة التالية {mor?.continue?.includes(state.mySeat) ? '⏳' : ''}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* منطقة أوراقي */}
      <div
        className={cn(
          'mt-1 rounded-t-3xl bg-black/40 px-2 pb-2 pt-1',
          myTurn && 'ring-2 ring-gold-400/70 shadow-[0_0_26px_rgba(212,175,55,0.35)]',
        )}
      >
        <div className="mb-1 flex items-center justify-between px-1 text-[10px]">
          <span className="font-bold text-ink-200">
            أوراقي ({hand.length}) {myTurn ? <span className="text-gold-300">• دورك الآن {secondsLeft !== null ? `(${secondsLeft}ث)` : ''}</span> : null}
          </span>
          <span className="text-ink-400">
            {mor?.needDraw ? 'اسحب ورقة ثم انزل أو ارمِ' : mor?.pilePending ? 'انزل بورقة من كومة الرمي' : 'اختر ورقة وارمِها'}
          </span>
        </div>

        {hint && <div className="mb-1 rounded-xl bg-rose-900/40 px-2 py-1 text-center text-[11px] text-rose-200">{hint}</div>}

        <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar">
          {hand.map((c, i) => (
            <button
              key={`${c}-${i}`}
              onClick={() => toggle(i)}
              className={cn(
                'shrink-0 transition-transform',
                selIdx.includes(i) && '-translate-y-2',
                // أوراق كومة الرمي تُميَّز بإطار سماوي: يجب أن تنزل أو تضيف واحدة منها قبل الرمي
                (mor?.pileCards ?? []).includes(c) && mor?.pilePending && 'rounded-lg ring-2 ring-sky-400/80',
              )}
            >
              <CardView code={c} size="sm" glow={selIdx.includes(i)} dim={!myTurn && state.phase === 'playing'} />
            </button>
          ))}
        </div>

        {myTurn && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Button variant="gold" size="sm" disabled={!selectionCheck?.ok} onClick={doMeld}>
              نزول {selectedPoints > 0 ? `(${morProjectLabel(selectedPoints)})` : ''}
            </Button>
            <Button variant="dark" size="sm" disabled={selected.length === 0 || myMelds.length === 0} onClick={doAdd}>
              إضافة إلى نزول فريقنا
            </Button>
            <Button variant="danger" size="sm" disabled={selected.length !== 1 || Boolean(mor?.pilePending)} onClick={doDiscard}>
              ارمِ
            </Button>
            <Button variant="ghost" size="sm" disabled={selected.length === 0} onClick={clear}>
              إلغاء التحديد
            </Button>
            {selectionCheck && !selectionCheck.ok && selected.length > 0 && (
              <span className="self-center text-[10px] text-rose-300">{selectionCheck.reason}</span>
            )}
            {selectionCheck?.ok && selectedPoints > 0 && (
              <span className="self-center text-[10px] text-emerald-300">نزول صالح — {morProjectLabel(selectedPoints)}</span>
            )}
          </div>
        )}
      </div>

      <ChatDrawer
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        state={state}
        onSend={(t, e) => actions.chat(t, e)}
        onSendVoice={actions.voice}
      />

      <Modal open={rulesOpen} onClose={() => setRulesOpen(false)} title="قوانين المور">
        <div className="space-y-2 text-xs leading-relaxed text-ink-200">
          <p>• ورقان (١٠٤) + جوكران — ١١ ورقة لكل لاعب، والذي يبدأ يأخذ ١٢ ويرميها في دوره.</p>
          <p>• كومتا مور جانبيتان (١١ لكل كومة): أول فريق ينهي أوراقه يأخذ كومة ويكمل، وكل فريق يأخذ مرة واحدة.</p>
          <p>• الـ ٢ والجوكر مبدّلان، وبحد أقصى جوكر واحد + ٢ واحد في النزول.</p>
          <p>• النزول: سلسلة (٣+ على التوالي بنفس اللون) أو طقم (ثلاثات فقط أو أصوص فقط).</p>
          <p>• المشروع: ٧ أوراق أو أكثر — ٣٠٠ (٧ ثلاثات/أصوص نظيفة)، ٢٠٠ (سلسلة نظيفة)، ١٥٠/١٠٠ (بمبدّل).</p>
          <p>• الإغلاق: ٣٠٠ مشاريع (٣٠٠ كاملة أو ٢٠٠+١٠٠)، ويمنع ٣×١٠٠ و٢×١٥٠.</p>
          <p>• أخذ كومة الرمي: بعد النزول، وتأخذها كاملة ويجب أن تنزل بورقة منها.</p>
          <p>• الطريقة الحالية: <b>{mor ? MOR_MODE_AR[mor.mode] : '—'}</b> — {mor?.mode === 'popular'
            ? 'قيمة الأوراق + ١٠٠ لكل مشروع (+١٠٠ للنظيف) + ١٠٠ للإغلاق، و−١٠٠ لمن لم يأخذ المور.'
            : 'الثلاثات ٠٫٥ والأسباع ١ والآس/الجوكر ١٫٥، والفائز +١٠ ومن لم يأخذ المور −١٠.'}</p>
          <p>• نفاد الرزمة: تنتهي اللقطة بلا فائز وتُحسب الأوراق الملعوبة ناقص الأوراق في اليد.</p>
        </div>
      </Modal>

      <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title="قائمة الطاولة">
        <div className="space-y-2">
          <div className="rounded-2xl bg-black/30 px-3 py-2 text-xs">
            رمز الطاولة: <b className="text-gold-300">{state.roomCode}</b>
          </div>
          <Button variant="ghost" full onClick={() => void navigator.clipboard?.writeText(String(state.roomCode))}>
            📋 نسخ الرمز
          </Button>
          <Button variant="danger" full onClick={onExit}>
            الخروج للردهة
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/* ============================ صف مقاعد فريق ============================ */

function SeatStrip({
  state,
  team,
  myTeam,
  compact,
}: {
  state: RoomState;
  team: 0 | 1;
  myTeam: number;
  compact?: boolean;
}) {
  const seats = [0, 1, 2, 3].filter((s) => s % 2 === team);
  return (
    <div className={cn('grid grid-cols-2 gap-2', compact && 'gap-1')}>
      {seats.map((seat) => {
        const pl = state.seats[seat];
        const isTurn = state.turn === seat && state.phase === 'playing';
        const cards = state.handCounts?.[seat] ?? 0;
        const isMe = seat === state.mySeat;
        const mine = team === myTeam;
        return (
          <div
            key={seat}
            className={cn(
              'flex items-center gap-2 rounded-2xl px-2 py-1.5',
              isTurn ? 'bg-gold-500/15 ring-2 ring-gold-400/80' : 'bg-black/30',
              mine && 'ring-1 ring-emerald-500/25',
            )}
          >
            <Avatar emoji={pl?.avatar ?? '🪑'} size={compact ? 24 : 30} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-bold">
                {pl?.name ?? 'مقعد فارغ'} {isMe && <span className="text-emerald-300">(أنت)</span>}
                {pl?.isBot && <span className="text-ink-400"> 🤖</span>}
              </div>
              <div className="text-[10px] text-ink-400">
                {cards} ورقة {isTurn && <span className="text-gold-300">• دوره</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
