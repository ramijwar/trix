import { useNav, type View } from '../lib/nav';
import { useStore } from '../lib/store';
import { cn } from '../lib/utils';
import { sfx } from '../lib/audio';

const ITEMS: { view: View; label: string; icon: string }[] = [
  { view: 'lobby', label: 'الردهة', icon: '🏠' },
  { view: 'leaderboard', label: 'المتصدرون', icon: '🏆' },
  { view: 'shop', label: 'المتجر', icon: '🛍️' },
  { view: 'profile', label: 'حسابي', icon: '👤' },
];

export function BottomNav() {
  const view = useNav((s) => s.view);
  const go = useNav((s) => s.go);
  const inRoom = view === 'room';
  if (inRoom) return null;
  return (
    <nav className="safe-bottom mx-2 mb-1 grid grid-cols-4 gap-1 rounded-3xl border border-white/10 bg-black/55 p-1.5">
      {ITEMS.map((it) => {
        const active = view === it.view;
        return (
          <button
            key={it.view}
            onClick={() => {
              sfx('click');
              go(it.view);
            }}
            className={cn('relative flex flex-col items-center gap-0.5 rounded-2xl py-2 text-[11px] font-bold transition', active ? 'text-gold-300' : 'text-ink-300')}
          >
            {active && <span className="absolute inset-0 rounded-2xl bg-gradient-to-b from-gold-500/25 to-gold-600/10 ring-1 ring-gold-500/40" />}
            <span className="relative z-10 text-lg">{it.icon}</span>
            <span className="relative z-10">{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function TopBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  const user = useStore((s) => s.user);
  return (
    <header className="safe-top flex items-center justify-between px-3 pb-2 pt-2">
      <div className="flex items-center gap-2">
        {onBack && (
          <button onClick={onBack} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm">
            ←
          </button>
        )}
        <h1 className="text-lg font-black">{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        {right}
        {user && (
          <div className="flex items-center gap-1.5 rounded-full border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 text-xs font-bold text-gold-300">
            <span>🪙</span>
            {new Intl.NumberFormat('en-US').format(user.coins)}
          </div>
        )}
      </div>
    </header>
  );
}
