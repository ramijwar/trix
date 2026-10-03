import { useEffect, useMemo, useRef, useState } from 'react';
import type { RoomState, RoundSummary as RoundSummaryData } from '../game/types';
import { SUIT_SYMBOL, parseCard, type Suit } from '../game/types';
import { cn, sortHand } from '../lib/utils';
import { formatDuration, voiceUrl } from '../lib/media';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { Button, Modal } from './ui';
import { CardView } from './CardView';
import { useStore } from '../lib/store';

/* ======================= يد اللاعب المصغّرة ======================= */
/**
 * تعرض أوراق اللاعب داخل لوحات القرار (المزايدة/اختيار الطرنيب/اختيار التسمية)
 * حتى يرى أوراقه كاملة قبل أن يطلب أو يمرّر أو يختار.
 */
export function MiniHand({ cards, size = 'sm', label }: { cards: string[]; size?: 'xs' | 'sm' | 'md'; label?: string }) {
  const codes = useMemo(() => sortHand(cards.map(parseCard)).map((c) => c.code), [cards]);
  return (
    <div className="rounded-2xl bg-black/30 p-1.5">
      <div className="mb-1 flex items-center justify-between px-1 text-[10px] text-ink-300">
        <span>{label ?? 'أوراقك — رتّبها قبل القرار'}</span>
        <span>{cards.length} ورقة</span>
      </div>
      <div className="no-scrollbar flex items-end overflow-x-auto pb-0.5" dir="rtl">
        {codes.map((c, i) => (
          <div key={c} className={cn('shrink-0', i > 0 && '-mr-2.5')}>
            <CardView code={c} size={size} />
          </div>
        ))}
      </div>
    </div>
  );
}

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
          اللطوش {state.tricksWon?.[0] ?? 0} - {state.tricksWon?.[1] ?? 0}
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
                <span className="text-base font-black">
                  {t.score}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full" style={{ background: t.color, width: `${t.pct}%` }} />
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
    <>
      {show && (
        <div
          key={mustChooseTrump ? 'trump' : 'bid'}
          className="glass absolute inset-x-2 bottom-2 z-40 max-h-[74vh] overflow-y-auto rounded-3xl p-2.5 shadow-panel"
        >
          <div className="mb-2">
            <MiniHand cards={state.myHand} size="xs" label="أوراقك — شاهدها قبل القرار" />
          </div>
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
        </div>
      )}
    </>
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
        <div
          className={cn('flex size-20 items-center justify-center rounded-full text-4xl', good ? 'bg-emerald-500/20' : 'bg-rose-500/20')}
        >
          {s.kaboot ? '👑' : good ? '🎉' : '😅'}
        </div>
        <div className="text-center">
          <div className="text-lg font-bold">
            {s.made ? 'نجح الطلب' : 'فشل الطلب'} — {s.bid} لطش
          </div>
          <div className="mt-1 text-sm text-ink-300">
            فريق الطلب أخذ <span className="font-bold text-ink-100">{s.teamTricks}</span> لطش
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
        <div className="text-6xl">
          {won ? '🏆' : '🤝'}
        </div>
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

/* ============================ الدردشة ============================ */
/**
 * مشغّل رسالة صوتية: زر تشغيل/إيقاف صغير (أيقونة) + مدة المقطع.
 * تُجلب الرسالة من الخادم مرة واحدة ثم تُشغَّل من الذاكرة.
 */
function VoicePlayer({ id, dur, roomId, roomCode, mine }: { id: string; dur: number; roomId: string; roomCode: string; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState(0);
  const [failed, setFailed] = useState('');

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const stop = () => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.currentTime = 0;
    }
    setPlaying(false);
    setPos(0);
  };

  const toggle = async () => {
    if (playing) {
      stop();
      return;
    }
    setFailed('');
    setLoading(true);
    try {
      const url = await voiceUrl(String(id), String(roomId || roomCode));
      let a = audioRef.current;
      if (!a) {
        a = new Audio(url);
        a.preload = 'auto';
        audioRef.current = a;
      } else if (a.src !== url) {
        a.src = url;
      }
      a.onended = () => {
        setPlaying(false);
        setPos(0);
      };
      a.ontimeupdate = () => setPos(a?.currentTime ?? 0);
      await a.play();
      setPlaying(true);
    } catch {
      setFailed('تعذّر تشغيل المقطع');
    } finally {
      setLoading(false);
    }
  };

  const shown = playing ? pos : dur;
  const total = Math.max(1, dur);
  const progress = Math.min(100, Math.round(((playing ? pos : 0) / total) * 100));
  return (
    <div className={cn('flex items-center gap-2', mine ? 'flex-row' : 'flex-row-reverse')}>
      <button
        onClick={() => void toggle()}
        className={cn(
          'grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] leading-none active:scale-90',
          playing ? 'bg-rose-600 text-white' : 'bg-gold-500 text-felt-950',
        )}
        aria-label={playing ? 'إيقاف المقطع' : 'تشغيل المقطع'}
        title={playing ? 'إيقاف' : 'تشغيل'}
      >
        {loading ? '…' : playing ? <StopIcon /> : <PlayIcon />}
      </button>
      <div className="min-w-[96px] flex-1">
        <div className="mb-1 flex items-center gap-1.5">
          <span className="text-[13px]">🎤</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/35">
            <div className={cn('h-full rounded-full', playing ? 'bg-rose-400' : 'bg-gold-400/70')} style={{ width: `${progress}%` }} />
          </div>
          <span className="w-9 shrink-0 text-center text-[10px] font-bold tabular-nums text-ink-200">{formatDuration(shown)}</span>
        </div>
        {failed && <div className="text-[10px] text-rose-300">{failed}</div>}
      </div>
    </div>
  );
}

/** أيقونة تشغيل صغيرة */
function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  );
}

/** أيقونة إيقاف صغيرة */
function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
    </svg>
  );
}

/** أيقونة ميكروفون */
function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('h-5 w-5', className)} fill="currentColor" aria-hidden="true">
      <path d="M12 15a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 1 0-7 0v5.5A3.5 3.5 0 0 0 12 15Z" />
      <path d="M18 11.5a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.9V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.6a6 6 0 0 0 5-5.9Z" />
    </svg>
  );
}

export function ChatDrawer({
  open,
  onClose,
  state,
  onSend,
  onSendVoice,
}: {
  open: boolean;
  onClose: () => void;
  state: RoomState;
  onSend: (text: string, emoji?: string) => void;
  /** إرسال رسالة صوتية (غير متاح في اللعب المحلي ضد البوتات) */
  onSendVoice?: (blob: Blob, duration: number, mime: string) => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const recorder = useVoiceRecorder(30);
  const endRef = useRef<HTMLDivElement | null>(null);
  const roomKey = String(state.roomId ?? state.roomCode ?? '');
  // رسائل اللاعبين فقط — بلا رسائل نظام ولا عبارات جاهزة، دردشة نظيفة
  const messages = useMemo(() => (state.chat ?? []).filter((m) => m.seat !== null).slice(-60), [state.chat]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' });
  }, [open, messages.length]);

  // إغلاق الدردشة أثناء التسجيل يلغي التسجيل (لا نترك الميكروفون مفتوحاً)
  const cancelRecording = recorder.cancel;
  useEffect(() => {
    if (!open) cancelRecording();
  }, [open, cancelRecording]);

  const sendText = () => {
    const value = text.trim();
    if (!value) return;
    onSend(value);
    setText('');
  };

  const sendingRef = useRef(false);
  const finishRecording = async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    try {
      const clip = await recorder.stop();
      if (!clip || !onSendVoice) return;
      setSending(true);
      try {
        await onSendVoice(clip.blob, clip.duration, clip.mime);
      } finally {
        setSending(false);
      }
    } finally {
      sendingRef.current = false;
    }
  };

  // بلوغ الحد الأقصى (٣٠ ثانية) يوقف التسجيل ويرسله تلقائياً
  const reachedLimit = recorder.recording && recorder.seconds >= recorder.maxSeconds;
  useEffect(() => {
    if (reachedLimit) void finishRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reachedLimit]);

  return (
    <>
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
          <div className="glass fixed inset-x-0 bottom-0 z-50 flex max-h-[78vh] flex-col rounded-t-3xl p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-bold">الدردشة</span>
              <button onClick={onClose} className="rounded-xl px-2 py-1 text-ink-300 hover:bg-white/10">
                ✕
              </button>
            </div>

            <div className="mb-2 flex-1 overflow-y-auto rounded-2xl bg-black/25 p-2">
              {messages.length === 0 && <div className="py-6 text-center text-sm text-ink-300">لا رسائل بعد</div>}
              {messages.map((m) => {
                const mine = m.seat === state.mySeat;
                const hasVoice = Boolean(m.voice);
                return (
                  <div key={m.id} className={cn('mb-1.5 flex', mine ? 'justify-start' : 'justify-end')}>
                    <div
                      className={cn(
                        'max-w-[80%] rounded-2xl px-3 py-1.5 text-sm',
                        mine ? 'bg-gold-500/25' : 'bg-white/12',
                        hasVoice && 'min-w-[190px]',
                      )}
                    >
                      {!mine && <div className="text-[10px] text-ink-300">{m.name}</div>}
                      {hasVoice ? (
                        <VoicePlayer
                          id={String(m.voice)}
                          dur={Number(m.dur ?? 0)}
                          roomId={roomKey}
                          roomCode={String(state.roomCode ?? '')}
                          mine={mine}
                        />
                      ) : (
                        <div>{m.text}</div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>

            {recorder.error && <div className="mb-2 rounded-xl bg-rose-900/40 px-3 py-1.5 text-center text-xs text-rose-200">{recorder.error}</div>}

            {recorder.recording ? (
              <div className="flex items-center gap-2 rounded-2xl bg-rose-950/60 px-3 py-2 ring-1 ring-rose-500/50">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
                <span className="text-xs font-bold tabular-nums text-rose-100">
                  {formatDuration(recorder.seconds)} / {formatDuration(recorder.maxSeconds)}
                </span>
                <span className="flex-1 text-center text-[11px] text-rose-200/80">جارٍ التسجيل…</span>
                <button
                  onClick={recorder.cancel}
                  className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-sm text-ink-200 active:scale-90"
                  aria-label="إلغاء التسجيل"
                  title="إلغاء"
                >
                  ✕
                </button>
                <button
                  onClick={() => void finishRecording()}
                  disabled={sending}
                  className="grid h-9 w-9 place-items-center rounded-full bg-rose-600 text-white active:scale-90 disabled:opacity-60"
                  aria-label="إيقاف وإرسال"
                  title="إيقاف وإرسال"
                >
                  <StopIcon />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') sendText();
                  }}
                  placeholder="اكتب رسالة…"
                  className="flex-1 rounded-2xl border border-white/12 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-ink-500"
                />
                <Button variant="gold" size="sm" onClick={sendText}>
                  إرسال
                </Button>
                {onSendVoice && (
                  <button
                    onClick={() => void recorder.start()}
                    disabled={sending}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-white/10 text-gold-300 active:scale-90 disabled:opacity-50"
                    aria-label="تسجيل رسالة صوتية"
                    title="تسجيل رسالة صوتية"
                  >
                    <MicIcon />
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
