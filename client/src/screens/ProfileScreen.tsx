import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useStore, type User } from '../lib/store';
import { BottomNav, TopBar } from '../components/Nav';
import { Avatar, Button, EmptyState, Modal, Panel, SectionTitle, Spinner, XpBar } from '../components/ui';
import { cn } from '../lib/utils';

interface HistoryItem {
  roomCode: string;
  won: boolean;
  score: [number, number];
  rounds: number;
  at: number;
  names: string[];
}

const AVATARS = ['🦊', '🐺', '🦁', '🐯', '🐻', '🐼', '🐨', '🐸', '🦅', '🦉', '🐬', '🦈', '😎', '🧔', '👳', '🧕'];

export function ProfileScreen() {
  const user = useStore((s) => s.user);
  const toast = useStore((s) => s.toast);
  const refreshUser = useStore((s) => s.refreshUser);
  const setUser = useStore((s) => s.setUser);
  const logout = useStore((s) => s.logout);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState(user?.name ?? '');
  const [avatar, setAvatar] = useState(user?.avatar ?? '🦊');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api<{ history: HistoryItem[] }>('profile', {}, { method: 'GET', timeout: 15000 });
        setHistory(res.history ?? []);
      } catch {
        /* تجاهل */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const res = await api<{ user: User }>('profile/update', { name: name.trim(), avatar });
      setUser(res.user);
      toast('تم تحديث الملف الشخصي ✅', 'success');
      setEditOpen(false);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const claimDaily = async () => {
    try {
      const res = await api<{ result: { granted: boolean; amount?: number; secondsLeft?: number } }>('profile/daily', {});
      if (res.result.granted) toast(`+${res.result.amount} 🪙 مكافأة يومية`, 'gold');
      else toast(`المكافأة بعد ${Math.floor((res.result.secondsLeft ?? 0) / 3600)} ساعة`, 'info');
      await refreshUser();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  if (!user) return null;

  return (
    <div className="screen-bg flex h-full flex-col">
      <TopBar title="حسابي" />
      <div className="flex-1 overflow-y-auto px-3 pb-2">
        <Panel className="mb-3" glow>
          <div className="flex items-center gap-3">
            <Avatar emoji={user.avatar} size={64} frame={user.avatarFrame} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-lg font-black">{user.name}</span>
                {user.isGuest && <span className="rounded-full bg-amber-500/20 px-2 text-[10px] font-bold text-amber-300">زائر</span>}
              </div>
              <div className="text-xs text-ink-300" dir="ltr">
                @{user.username}
              </div>
              <div className="mt-1.5">
                <XpBar into={user.levelInto} need={user.levelNeed} />
              </div>
              <div className="mt-0.5 text-[11px] text-ink-300">
                مستوى {user.level} • {user.levelInto}/{user.levelNeed} خبرة
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}>
              تعديل
            </Button>
          </div>
        </Panel>

        <div className="mb-3 grid grid-cols-2 gap-2">
          {[
            { label: 'مباريات', value: user.gamesPlayed, icon: '🎮' },
            { label: 'انتصارات', value: user.gamesWon, icon: '🏅' },
            { label: 'نسبة الفوز', value: `${user.winRate}%`, icon: '📈' },
            { label: 'كبوت', value: user.kaboot, icon: '👑' },
            { label: 'أفضل سلسلة', value: user.maxStreak, icon: '🔥' },
            { label: 'العملات', value: user.coins, icon: '🪙' },
          ].map((s) => (
            <div key={s.label} className="glass rounded-2xl p-3 text-center">
              <div className="text-xl">{s.icon}</div>
              <div className="text-lg font-black text-gold-300">{s.value}</div>
              <div className="text-[11px] text-ink-300">{s.label}</div>
            </div>
          ))}
        </div>

        <Button variant="ghost" full className="mb-3" onClick={() => void claimDaily()}>
          🎁 المكافأة اليومية
        </Button>

        <SectionTitle icon={<span>📜</span>}>آخر المباريات</SectionTitle>
        {loading && <Spinner />}
        {!loading && history.length === 0 && <EmptyState icon="🃏" title="لا مباريات بعد" hint="العب أول مباراة كاملة وستظهر هنا" />}
        <div className="space-y-2">
          {history.map((h, i) => (
            <div key={i} className="glass flex items-center gap-3 rounded-2xl p-3">
              <div className={cn('flex size-10 items-center justify-center rounded-2xl text-lg', h.won ? 'bg-emerald-500/20' : 'bg-rose-500/20')}>
                {h.won ? '🏆' : '💔'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold">
                  {h.won ? 'فوز' : 'خسارة'} — <span dir="ltr">{h.score[0]} : {h.score[1]}</span>
                </div>
                <div className="text-[11px] text-ink-300">
                  {h.rounds} جولات • {new Date(h.at * 1000).toLocaleDateString('ar-EG')} • غرفة <span dir="ltr">{h.roomCode}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <Button variant="danger" full className="mt-4" onClick={() => void logout()}>
          تسجيل الخروج
        </Button>
      </div>
      <BottomNav />

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="تعديل الملف الشخصي">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-ink-300">الاسم المعروض</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
              className="w-full rounded-2xl border border-white/12 bg-black/30 px-3 py-2.5 outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-300">الصورة الرمزية</label>
            <div className="grid grid-cols-8 gap-2">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  onClick={() => setAvatar(a)}
                  className={cn('flex aspect-square items-center justify-center rounded-full bg-white/8 text-xl', avatar === a && 'ring-2 ring-gold-400')}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
          <Button variant="gold" full loading={busy} onClick={() => void save()}>
            حفظ
          </Button>
        </div>
      </Modal>
    </div>
  );
}
