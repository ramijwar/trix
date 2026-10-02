import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { useNav } from '../lib/nav';
import { BottomNav, TopBar } from '../components/Nav';
import { Avatar, Button, Modal, Panel, SectionTitle, Spinner, XpBar } from '../components/ui';
import type { LobbyStats, RoomListItem } from '../game/types';
import { cn, timeAgo } from '../lib/utils';
import { OfflineMatch } from '../game/offline';

export function LobbyScreen() {
  const user = useStore((s) => s.user);
  const toast = useStore((s) => s.toast);
  const refreshUser = useStore((s) => s.refreshUser);
  const go = useNav((s) => s.go);
  const enterRoom = useNav((s) => s.enterRoom);
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [stats, setStats] = useState<LobbyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState('');
  const [dailyReady, setDailyReady] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ rooms: RoomListItem[]; stats: LobbyStats }>('lobby', { limit: 30 }, { method: 'GET', timeout: 15000 });
      setRooms(res.rooms ?? []);
      setStats(res.stats ?? null);
    } catch {
      /* تجاهل الخطأ المؤقت */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [load]);

  const quickPlay = async (game: 'tarnib' | 'trix' = 'tarnib') => {
    setBusy(game === 'trix' ? 'quick2' : 'quick');
    try {
      const res = await api<{ room: { roomId: string; roomCode: string } }>('room/quick', { settings: { game, kingdoms: 1, target: 31 } });
      // أكمل الطاولة بالبوتات ليبدأ اللعب فوراً
      for (let i = 0; i < 3; i++) {
        try {
          await api('room/bot/add', { room: res.room.roomId });
        } catch {
          break;
        }
      }
      toast('تم إيجاد طاولة — بالتوفيق! 🎉', 'success');
      enterRoom(res.room.roomId, res.room.roomCode);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  };

  const joinByCode = async () => {
    if (joinCode.trim().length < 4) {
      toast('أدخل رمز الغرفة', 'error');
      return;
    }
    setBusy('join');
    try {
      const res = await api<{ room: { roomId: string; roomCode: string } }>('room/join', { room: joinCode.trim().toUpperCase() });
      enterRoom(res.room.roomId, res.room.roomCode);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  };

  const claimDaily = async () => {
    try {
      const res = await api<{ result: { granted: boolean; amount?: number; secondsLeft?: number }; user: typeof user }>('profile/daily', {});
      if (res.result.granted) {
        toast(`مكافأة يومية: +${res.result.amount} 🪙`, 'gold');
        await refreshUser();
      } else {
        const hours = Math.floor((res.result.secondsLeft ?? 0) / 3600);
        toast(`المكافأة القادمة بعد ${hours} ساعة`, 'info');
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  useEffect(() => {
    void api<{ result: { granted: boolean } }>('profile/daily', {}, { timeout: 8000 })
      .then((r) => setDailyReady(r.result.granted))
      .catch(() => setDailyReady(false));
  }, []);

  const startOffline = () => {
    const match = new OfflineMatch({
      playerName: user?.name ?? 'لاعب',
      avatar: user?.avatar ?? '🦊',
      playerLevel: user?.level ?? 1,
    });
    window.__trixOffline = match;
    enterRoom('offline', 'BOTS');
  };

  if (!user) return null;

  return (
    <div className="screen-bg flex h-full flex-col">
      <TopBar
        title="الردهة"
        right={
          <button onClick={() => go('settings')} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm">
            ⚙️
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-3 pb-2">
        {/* بطاقة اللاعب */}
        <Panel className="anim-float-in mb-3">
          <div className="flex items-center gap-3">
            <Avatar emoji={user.avatar} size={56} frame={user.avatarFrame} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-bold">{user.name}</span>
                <span className="rounded-full bg-sky-500/20 px-2 text-[11px] font-bold text-sky-300">مستوى {user.level}</span>
              </div>
              <div className="mt-1.5">
                <XpBar into={user.levelInto} need={user.levelNeed} />
              </div>
              <div className="mt-1 flex gap-3 text-[11px] text-ink-300">
                <span>🎮 {user.gamesPlayed} مباراة</span>
                <span>🏅 {user.gamesWon} فوز</span>
                <span>👑 {user.kaboot} كبوت</span>
              </div>
            </div>
            {dailyReady && (
              <button onClick={() => void claimDaily()} className="anim-turn-ring rounded-2xl bg-gradient-to-b from-gold-300 to-gold-600 px-3 py-2 text-xs font-black text-felt-950">
                مكافأة
                <br />
                يومية 🎁
              </button>
            )}
          </div>
        </Panel>

        {/* الأزرار الرئيسية */}
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Button variant="gold" size="lg" loading={busy === 'quick'} onClick={() => void quickPlay('tarnib')} className="h-16 flex-col !gap-0.5">
            <span className="text-xl">⚡</span>
            <span className="text-sm">طرنيب سريع</span>
          </Button>
          <Button variant="blue" size="lg" loading={busy === 'quick2'} onClick={() => void quickPlay('trix')} className="h-16 flex-col !gap-0.5 !bg-emerald-600">
            <span className="text-xl">🧩</span>
            <span className="text-sm">تركس سريع</span>
          </Button>
          <Button variant="blue" size="lg" onClick={() => setCreateOpen(true)} className="h-16 flex-col !gap-0.5">
            <span className="text-xl">➕</span>
            <span className="text-sm">إنشاء طاولة</span>
          </Button>
          <Button variant="ghost" onClick={() => setJoinOpen(true)}>
            🔑 انضمام برمز
          </Button>
          <Button variant="ghost" onClick={startOffline}>
            🤖 تدريب ضد البوتات
          </Button>
        </div>

        {/* إحصاءات */}
        {stats && (
          <div className="mb-3 grid grid-cols-3 gap-2 text-center">
            <div className="glass rounded-2xl py-2">
              <div className="text-lg font-black text-gold-300">{stats.online}</div>
              <div className="text-[11px] text-ink-300">متصل الآن</div>
            </div>
            <div className="glass rounded-2xl py-2">
              <div className="text-lg font-black text-emerald-300">{stats.rooms}</div>
              <div className="text-[11px] text-ink-300">طاولة مفتوحة</div>
            </div>
            <div className="glass rounded-2xl py-2">
              <div className="text-lg font-black text-sky-300">{stats.matches}</div>
              <div className="text-[11px] text-ink-300">مباراة كاملة</div>
            </div>
          </div>
        )}

        {/* قائمة الغرف */}
        <SectionTitle icon={<span>🃏</span>} action={<span className="text-xs text-ink-500">تُحدَّث تلقائياً</span>}>
          الطاولات المتاحة
        </SectionTitle>

        {loading && <Spinner label="جارٍ تحميل الطاولات…" />}
        {!loading && rooms.length === 0 && (
          <Panel className="text-center text-sm text-ink-300">
            لا توجد طاولات مفتوحة الآن — أنشئ واحدة وادعُ أصدقاءك! 🎴
          </Panel>
        )}
        <div className="space-y-2">
          {rooms.map((r) => (
            <motion.button
              key={r.id}
              layout
              onClick={() => enterRoom(r.id, r.code)}
              className="glass flex w-full items-center gap-3 rounded-2xl p-3 text-right transition active:scale-[.99]"
            >
              <div className={cn('flex size-11 items-center justify-center rounded-2xl text-xl', r.status === 'playing' ? 'bg-rose-500/20' : 'bg-emerald-500/20')}>
                {r.status === 'playing' ? '🔥' : r.game === 'trix' ? '🧩' : '🪑'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-bold">{r.name || `طاولة ${r.code}`}</span>
                  {r.hasPassword && <span className="text-xs">🔒</span>}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-300">
                  <span>
                    {r.players}/4 لاعبين
                    {r.humans > 0 && ` • ${r.humans} حقيقي`}
                  </span>
                  <span>•</span>
                  <span className={cn(r.game === 'trix' ? 'text-emerald-300' : 'text-sky-300')}>
                    {r.game === 'trix' ? 'تركس 🧩' : 'طرنيب 🃏'}
                  </span>
                  <span>•</span>
                  <span>{r.game === 'trix' ? `${r.kingdoms ?? 4} ممالك` : `هدف ${r.target}`}</span>
                  {r.status === 'playing' && r.game !== 'trix' && (
                    <>
                      <span>•</span>
                      <span className="text-rose-300">
                        جولة {r.round} ({r.scores[0]} - {r.scores[1]})
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="text-[10px] text-ink-500">{timeAgo(Math.max(0, Math.floor(Date.now() / 1000) - r.updatedAt))}</div>
            </motion.button>
          ))}
        </div>
      </div>

      <BottomNav />

      {/* إنشاء طاولة */}
      <CreateRoomModal open={createOpen} onClose={() => setCreateOpen(false)} />
      {/* انضمام برمز */}
      <Modal open={joinOpen} onClose={() => setJoinOpen(false)} title="الانضمام برمز الغرفة">
        <input
          dir="ltr"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          placeholder="ABC12"
          maxLength={8}
          className="mb-3 w-full rounded-2xl border border-white/12 bg-black/30 px-3 py-3 text-center text-2xl font-black tracking-[0.3em] outline-none"
        />
        <Button variant="gold" full loading={busy === 'join'} onClick={() => void joinByCode()}>
          دخول الطاولة
        </Button>
      </Modal>
    </div>
  );
}

function CreateRoomModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useStore((s) => s.toast);
  const enterRoom = useNav((s) => s.enterRoom);
  const [name, setName] = useState('');
  const [game, setGame] = useState<'tarnib' | 'trix'>('tarnib');
  const [kingdoms, setKingdoms] = useState<1 | 2 | 4>(4);
  const [target, setTarget] = useState<31 | 41 | 61>(31);
  const [turnTime, setTurnTime] = useState(30);
  const [allowDouble, setAllowDouble] = useState(false);
  const [allowNoTrump, setAllowNoTrump] = useState(false);
  const [privateRoom, setPrivateRoom] = useState(false);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const res = await api<{ room: { roomId: string; roomCode: string } }>('room/create', {
        name: name.trim() || 'طاولة الأصدقاء',
        private: privateRoom,
        settings: { game, kingdoms, target, turnTime, bidTime: turnTime, allowDouble, allowNoTrump },
      });
      toast(`تم إنشاء الطاولة — الرمز ${res.room.roomCode}`, 'success');
      onClose();
      enterRoom(res.room.roomId, res.room.roomCode);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="إنشاء طاولة جديدة">
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs text-ink-300">نوع اللعبة</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setGame('tarnib')}
              className={cn('rounded-2xl px-3 py-2.5 text-right transition', game === 'tarnib' ? 'bg-sky-600 text-white' : 'bg-white/8')}
            >
              <span className="block text-sm font-black">🃏 طرنيب</span>
              <span className="block text-[10px] opacity-80">شراكة • طلب ٧–١٣ • هدف {target}</span>
            </button>
            <button
              onClick={() => setGame('trix')}
              className={cn('rounded-2xl px-3 py-2.5 text-right transition', game === 'trix' ? 'bg-emerald-600 text-white' : 'bg-white/8')}
            >
              <span className="block text-sm font-black">🧩 تركس</span>
              <span className="block text-[10px] opacity-80">فردي • ٥ تسميات • ختيار الكبة</span>
            </button>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-ink-300">اسم الطاولة</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثال: شلة الخميس"
            className="w-full rounded-2xl border border-white/12 bg-black/30 px-3 py-2.5 outline-none"
          />
        </div>

        {game === 'trix' && (
          <div>
            <label className="mb-1 block text-xs text-ink-300">عدد الممالك (طول المباراة)</label>
            <div className="grid grid-cols-3 gap-2">
              {([1, 2, 4] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setKingdoms(k)}
                  className={cn('rounded-2xl py-2 text-sm font-bold transition', kingdoms === k ? 'bg-emerald-500 text-felt-950' : 'bg-white/8 text-ink-100')}
                >
                  {k === 1 ? 'سريعة (١)' : k === 2 ? 'متوسطة (٢)' : 'كاملة (٤)'}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-ink-500">كل مملكة = ٥ تسميات (الكبة، البنات، الديناري، اللطوش، التركس) = ٢٠ توزيعة في المباراة الكاملة.</p>
          </div>
        )}

        <div className={cn(game === 'trix' && 'hidden')}>
          <label className="mb-1 block text-xs text-ink-300">النقاط المطلوبة للفوز</label>
          <div className="grid grid-cols-3 gap-2">
            {([31, 41, 61] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTarget(t)}
                className={cn('rounded-2xl py-2 font-bold transition', target === t ? 'bg-gold-500 text-felt-950' : 'bg-white/8 text-ink-100')}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-ink-300">مؤقت الدور / المزايدة</label>
          <div className="grid grid-cols-4 gap-2">
            {[0, 15, 30, 45].map((t) => (
              <button
                key={t}
                onClick={() => setTurnTime(t)}
                className={cn('rounded-2xl py-2 text-sm font-bold transition', turnTime === t ? 'bg-gold-500 text-felt-950' : 'bg-white/8')}
              >
                {t === 0 ? 'بلا' : `${t}ث`}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {[
            {
              label: 'السماح بالمضاعفة (دبل)',
              value: allowDouble,
              set: setAllowDouble,
              hint: game === 'trix' ? 'كشف البنات وختيار الكبة لمضاعفة النقاط' : 'الخصم يضاعف الطلب ×2',
            },
            ...(game === 'trix'
              ? []
              : [{ label: 'السماح بطلب بدون طرنيب', value: allowNoTrump, set: setAllowNoTrump, hint: 'وضع احترافي' }]),
            { label: 'طاولة خاصة', value: privateRoom, set: setPrivateRoom, hint: 'لا تظهر في القائمة' },
          ].map((row) => (
            <button
              key={row.label}
              onClick={() => row.set(!row.value)}
              className="flex w-full items-center justify-between rounded-2xl bg-black/25 px-3 py-2.5 text-right"
            >
              <span>
                <span className="block text-sm font-bold">{row.label}</span>
                <span className="block text-[11px] text-ink-500">{row.hint}</span>
              </span>
              <span className={cn('flex h-6 w-11 items-center rounded-full px-0.5 transition', row.value ? 'justify-end bg-gold-500' : 'justify-start bg-white/15')}>
                <span className="size-5 rounded-full bg-white shadow" />
              </span>
            </button>
          ))}
        </div>

        <Button variant="gold" full size="lg" loading={busy} onClick={() => void create()}>
          إنشاء الطاولة
        </Button>
        <p className="text-center text-[11px] text-ink-500">
          {game === 'trix'
            ? 'التركس لعبة فردية: كل لاعب لنفسه، والفائز صاحب أعلى مجموع — يمكنك إضافة بوتات للتدريب.'
            : 'الشركاء: كل لاعبين متقابلين فريق واحد — يمكنك دعوة صديق ليجلس مقابل لك.'}
        </p>
      </div>
    </Modal>
  );
}
