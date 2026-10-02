import { useEffect, useState } from 'react';
import type { RoomSettings, RoomState, Suit, TrixContract } from '../game/types';
import { TEAM_COLORS, cn, shareText } from '../lib/utils';
import { Avatar, Button, EmptyState, Modal, Panel, SectionTitle } from './ui';
import { GameTable } from './GameTable';
import { BidPanel, ChatDrawer, GameOver, RoundSummary, ScoreBar } from './GamePanels';
import { TrixView } from './TrixView';
import { useGameSounds } from '../hooks/useGameSounds';
import { useStore } from '../lib/store';
import { keepScreenOn } from '../lib/native';

/** الإجراءات الموحّدة بين اللعب أونلاين واللعب المحلي */
export interface RoomActions {
  bid: (action: 'bid' | 'pass' | 'double', value?: number) => void;
  trump: (suit: Suit | 'NT') => void;
  /** اختيار تسمية في التركس (صاحب المملكة) */
  chooseContract?: (contract: TrixContract) => void;
  /** كشف/تدبيل ورقة، أو تأكيد الجاهزية لبدء اللعب */
  reveal?: (card?: string, done?: boolean) => void;
  play: (code: string) => void;
  chat: (text: string, emoji?: string) => void;
  continueRound: () => void;
  leave: () => void;
  ready?: (ready: boolean) => void;
  start?: () => void;
  addBot?: (seat?: number) => void;
  removeBot?: (seat: number) => void;
  sit?: (seat: number) => void;
  swap?: (seat: number) => void;
  respondSwap?: (accept: boolean) => void;
  saveSettings?: (settings: Partial<RoomSettings>) => void;
  kick?: (seat: number) => void;
}

/* ============================ شريط الحالة ============================ */
function ConnBadge({ status }: { status: 'connecting' | 'online' | 'offline' }) {
  const map = {
    connecting: { text: 'جارٍ الاتصال…', color: 'bg-amber-500' },
    online: { text: 'متصل', color: 'bg-emerald-500' },
    offline: { text: 'انقطع الاتصال', color: 'bg-rose-500' },
  } as const;
  const it = map[status];
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-bold">
      <span className={cn('size-2 rounded-full', it.color, status !== 'online' && 'animate-pulse')} />
      {it.text}
    </span>
  );
}

/* ============================ شاشة اللعب ============================ */
export function GameView({
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
  const [shake, setShake] = useState(false);
  const isTrix = state.game === 'trix' || state.settings?.game === 'trix';
  useGameSounds(state, state.mySeat);

  useEffect(() => {
    keepScreenOn(true);
    return () => keepScreenOn(false);
  }, []);

  const play = (code: string) => {
    if (!state.legalCards.includes(code)) {
      setShake(true);
      setTimeout(() => setShake(false), 400);
      return;
    }
    actions.play(code);
  };

  // لعبة التركس لها واجهتها الخاصة (تسميات، مجموعات، تدبيل)
  if (isTrix) {
    return <TrixView state={state} actions={actions} status={status} onExit={onExit} />;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="safe-top flex items-center justify-between px-3 pb-1 pt-2">
        <div className="flex items-center gap-2">
          <button onClick={() => setMenuOpen(true)} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm">
            ☰
          </button>
          <div className="font-black">
            {state.roomName || 'طاولة'}
            <span className="ms-2 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold tracking-widest text-gold-300" dir="ltr">
              {state.roomCode}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ConnBadge status={status} />
          <button onClick={() => setChatOpen(true)} className="relative rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm">
            💬
          </button>
        </div>
      </header>

      <ScoreBar state={state} />

      <GameTable state={state} onPlayCard={play} cardBack="red" shake={shake}>
        <BidPanel
          state={state}
          onBid={(v) => actions.bid('bid', v)}
          onPass={() => actions.bid('pass')}
          onDouble={() => actions.bid('double')}
          onTrump={(s) => actions.trump(s)}
        />
      </GameTable>

      <RoundSummary state={state} onContinue={() => actions.continueRound()} />
      <GameOver state={state} onExit={onExit} onRematch={() => actions.continueRound()} />

      <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} state={state} onSend={(t, e) => actions.chat(t, e)} />

      <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title="قائمة الطاولة">
        <div className="space-y-2">
          <Button variant="ghost" full onClick={() => void shareText(`انضم إليّ في طاولة الطرنيب! الرمز: ${state.roomCode}`)}>
            📤 دعوة صديق (مشاركة الرمز)
          </Button>
          <Button variant="danger" full onClick={onExit}>
            🚪 الخروج من الطاولة
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/* ============================ غرفة الانتظار ============================ */
export function WaitingRoom({
  state,
  actions,
  onExit,
  canStartHint = true,
}: {
  state: RoomState;
  actions: RoomActions;
  onExit: () => void;
  canStartHint?: boolean;
}) {
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const toast = useStore((s) => s.toast);
  const me = state.seats[state.mySeat];
  const filled = state.seats.filter(Boolean).length;
  const freeSeats = state.seats.map((p, i) => (p === null && i !== state.mySeat ? i : -1)).filter((i) => i >= 0);

  /** زر النسخ: ينسخ رمز الغرفة وحده فقط ليلصقه اللاعبون مباشرة */
  const copyCode = async () => {
    const { copyText, nativeToast } = await import('../lib/native');
    const done = await copyText(state.roomCode);
    nativeToast(done ? 'تم نسخ الرمز ✅' : 'تعذّر النسخ');
    toast(done ? `تم نسخ الرمز ${state.roomCode}` : 'تعذّر نسخ الرمز', done ? 'success' : 'error');
  };

  /** زر الدعوة: رسالة كاملة للمشاركة مع الأصدقاء */
  const invite = async () => {
    const gameName = state.settings?.game === 'trix' ? 'التركس' : 'الطرنيب';
    await shareText(`انضم إليّ في طاولة ${gameName}! رمز الغرفة: ${state.roomCode}`, 'طرنيب وتركس أونلاين');
  };

  const seatLabel = (seat: number) => {
    const rel = (seat - state.mySeat + 4) % 4;
    return ['أنت', 'اللاعب على يمينك', 'شريكك (المقابل)', 'اللاعب على يسارك'][rel];
  };

  return (
    <div className="screen-bg flex h-full flex-col">
      <header className="safe-top flex items-center justify-between px-3 pb-2 pt-2">
        <button onClick={onExit} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm">
          ← خروج
        </button>
        <div className="text-center">
          <div className="text-sm font-black">
            {state.roomName || 'طاولة'}{' '}
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-black', state.settings?.game === 'trix' ? 'bg-emerald-600/60' : 'bg-sky-600/60')}>
              {state.settings?.game === 'trix' ? 'تركس 🧩' : 'طرنيب 🃏'}
            </span>
          </div>
          <div className="text-[11px] text-ink-300">
            {filled}/4 لاعبين •{' '}
            {state.settings?.game === 'trix' ? `${state.settings?.kingdoms ?? 4} ممالك` : `هدف ${state.target}`}
          </div>
        </div>
        <button onClick={() => setChatOpen(true)} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm">
          💬
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {/* رمز الدعوة */}
        <Panel className="mb-3 text-center" glow>
          <div className="text-xs text-ink-300">رمز الدعوة — شاركه مع أصدقائك</div>
          <div className="my-2 text-4xl font-black tracking-[0.35em] text-gold-300" dir="ltr">
            {state.roomCode}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => void copyCode()}>
              📋 نسخ الرمز
            </Button>
            <Button variant="gold" onClick={() => actions.ready?.(!me?.ready)}>
              {me?.ready ? '✅ جاهز — إلغاء' : 'أنا جاهز'}
            </Button>
          </div>
          <button onClick={() => void invite()} className="mt-2 w-full rounded-2xl bg-white/5 py-2 text-xs text-ink-300">
            📤 أو دعوة صديق برسالة جاهزة
          </button>
        </Panel>

        {/* نوع اللعبة */}
        <Panel className={cn('mb-3 border', state.settings?.game === 'trix' ? 'border-emerald-500/30' : 'border-sky-500/30')}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-black">
                {state.settings?.game === 'trix' ? '🧩 تركس' : '🃏 طرنيب'}
              </div>
            </div>
            {state.isHost ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => actions.saveSettings?.({ game: state.settings?.game === 'trix' ? 'tarnib' : 'trix' })}
              >
                تبديل إلى {state.settings?.game === 'trix' ? 'طرنيب' : 'تركس'}
              </Button>
            ) : null}
          </div>
        </Panel>

        {/* المقاعد */}
        <SectionTitle icon={<span>🪑</span>}>
          {state.settings?.game === 'trix' ? 'اللاعبون (فردي)' : 'المقاعد والفريقان'}
        </SectionTitle>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {state.seats.map((p, seat) => {
            const team = seat % 2;
            const isMe = seat === state.mySeat;
            return (
              <div
                key={seat}
                className={cn('glass relative rounded-2xl p-3', isMe && 'ring-2 ring-gold-400/70')}
                style={{ borderTop: `3px solid ${TEAM_COLORS[team]}` }}
              >
                {p ? (
                  <div className="flex items-center gap-2">
                    <Avatar emoji={p.avatar} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{p.name}</div>
                      <div className="text-[10px] text-ink-300">
                        {seatLabel(seat)}
                        {p.isBot && ' • بوت'}
                        {!p.connected && !p.isBot && ' • منقطع'}
                      </div>
                    </div>
                    {p.ready ? <span className="text-xs text-emerald-400">✅</span> : <span className="text-xs text-ink-500">⏳</span>}
                  </div>
                ) : (
                  <button onClick={() => actions.sit?.(seat)} className="flex h-[46px] w-full flex-col items-center justify-center gap-0.5 text-xs text-ink-300">
                    <span className="text-lg">➕</span>
                    اجلس هنا
                  </button>
                )}
                {!p && state.isHost && (
                  <button
                    onClick={() => actions.addBot?.(seat)}
                    className="mt-1 w-full rounded-xl bg-white/5 py-1 text-[10px] text-ink-300"
                  >
                    🤖 إضافة بوت
                  </button>
                )}
                {p?.isBot && state.isHost && (
                  <button onClick={() => actions.removeBot?.(seat)} className="mt-1 w-full rounded-xl bg-rose-900/40 py-1 text-[10px] text-rose-200">
                    إزالة البوت
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2 text-center text-[11px]">
          <div className="rounded-2xl bg-sky-500/10 px-2 py-2">
            <span className="font-bold" style={{ color: TEAM_COLORS[0] }}>
              الفريق الأزرق
            </span>
            <div className="mt-0.5 text-ink-300">المقعدان 1 و 3 (المتقابلان)</div>
          </div>
          <div className="rounded-2xl bg-orange-500/10 px-2 py-2">
            <span className="font-bold" style={{ color: TEAM_COLORS[1] }}>
              الفريق البرتقالي
            </span>
            <div className="mt-0.5 text-ink-300">المقعدان 2 و 4 (المتقابلان)</div>
          </div>
        </div>

        {state.isHost ? (
          <div className="space-y-2">
            <Button variant="success" full size="lg" onClick={() => actions.start?.()} disabled={filled < 4}>
              🎮 ابدأ المباراة {filled < 4 && `(ناقص ${4 - filled})`}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={() => setSettingsOpen(true)}>
                ⚙️ إعدادات الطاولة
              </Button>
              <Button variant="ghost" onClick={() => actions.addBot?.()}>
                🤖 إضافة بوت
              </Button>
            </div>
          </div>
        ) : (
          <Panel className="text-center text-sm text-ink-300">
            {canStartHint ? 'بانتظار أن يبدأ المضيف المباراة…' : ''}
            {me && !me.ready && ' اضغط «أنا جاهز» ليعرف المضيف أنك مستعد.'}
            {me?.ready && ' أنت جاهز ✅ — سيبدأ المضيف اللعب قريباً.'}
          </Panel>
        )}

        {state.chat.length > 0 && (
          <div className="mt-3">
            <SectionTitle icon={<span>💬</span>}>آخر الرسائل</SectionTitle>
            <Panel className="space-y-1 text-sm">
              {state.chat.slice(-4).map((c) => (
                <div key={c.id} className="flex gap-2">
                  <span className="font-bold text-gold-300">{c.name}:</span>
                  <span className="text-ink-100">{c.text}</span>
                </div>
              ))}
            </Panel>
          </div>
        )}

        {state.swapRequests.length > 0 && (
          <Panel className="mt-3" glow>
            <div className="text-sm font-bold">طلب تبديل مكان 🔄</div>
            <div className="mt-1 text-xs text-ink-300">اللاعب في المقعد {state.swapRequests[0].from + 1} يريد التبديل معك (لتصبحا شريكين).</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button variant="success" onClick={() => actions.respondSwap?.(true)}>
                موافق
              </Button>
              <Button variant="dark" onClick={() => actions.respondSwap?.(false)}>
                رفض
              </Button>
            </div>
          </Panel>
        )}

        {freeSeats.length > 0 && (
          <div className="mt-3">
            <SectionTitle icon={<span>🔄</span>}>تغيير مقعدي</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {freeSeats.map((seat) => (
                <Button key={seat} variant="ghost" size="sm" onClick={() => actions.sit?.(seat)}>
                  {seatLabel(seat)} {seat % 2 === state.mySeat % 2 ? '(نفس لون فريقي)' : '(الفريق الآخر)'}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} state={state} onSend={(t, e) => actions.chat(t, e)} />

      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="إعدادات الطاولة">
        <SettingsForm state={state} onSave={(s) => {
          actions.saveSettings?.(s);
          setSettingsOpen(false);
        }} />
      </Modal>

      {filled === 0 && <EmptyState icon="🪑" title="غرفة فارغة" hint="ادعُ أصدقاءك بالرمز" />}
    </div>
  );
}

function SettingsForm({ state, onSave }: { state: RoomState; onSave: (s: Partial<RoomSettings>) => void }) {
  const [target, setTarget] = useState<31 | 41 | 61>(state.target as 31 | 41 | 61);
  const [turnTime, setTurnTime] = useState(state.settings.turnTime);
  const [allowDouble, setAllowDouble] = useState(state.settings.allowDouble);
  const [allowNoTrump, setAllowNoTrump] = useState(state.settings.allowNoTrump);
  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs text-ink-300">الهدف</label>
        <div className="grid grid-cols-3 gap-2">
          {([31, 41, 61] as const).map((t) => (
            <button key={t} onClick={() => setTarget(t)} className={cn('rounded-2xl py-2 font-bold', target === t ? 'bg-gold-500 text-felt-950' : 'bg-white/8')}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs text-ink-300">مؤقت الدور (ثانية)</label>
        <div className="grid grid-cols-4 gap-2">
          {[0, 15, 30, 45].map((t) => (
            <button key={t} onClick={() => setTurnTime(t)} className={cn('rounded-2xl py-2 text-sm font-bold', turnTime === t ? 'bg-gold-500 text-felt-950' : 'bg-white/8')}>
              {t === 0 ? 'بلا' : t}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <button onClick={() => setAllowDouble(!allowDouble)} className="flex w-full items-center justify-between rounded-2xl bg-black/25 px-3 py-2.5">
          <span className="text-sm font-bold">السماح بالمضاعفة</span>
          <span className={cn('flex h-6 w-11 items-center rounded-full px-0.5', allowDouble ? 'justify-end bg-gold-500' : 'justify-start bg-white/15')}>
            <span className="size-5 rounded-full bg-white" />
          </span>
        </button>
        <button onClick={() => setAllowNoTrump(!allowNoTrump)} className="flex w-full items-center justify-between rounded-2xl bg-black/25 px-3 py-2.5">
          <span className="text-sm font-bold">بدون طرنيب (NT)</span>
          <span className={cn('flex h-6 w-11 items-center rounded-full px-0.5', allowNoTrump ? 'justify-end bg-gold-500' : 'justify-start bg-white/15')}>
            <span className="size-5 rounded-full bg-white" />
          </span>
        </button>
      </div>
      <Button variant="gold" full onClick={() => onSave({ target, turnTime, bidTime: turnTime, allowDouble, allowNoTrump })}>
        حفظ الإعدادات
      </Button>
    </div>
  );
}
