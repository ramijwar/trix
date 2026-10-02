import { motion, AnimatePresence } from 'framer-motion';
import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/utils';
import { useStore } from '../lib/store';
import { sfx } from '../lib/audio';

/* ============================== أزرار ============================== */

type Variant = 'gold' | 'ghost' | 'dark' | 'danger' | 'success' | 'blue';

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  loading?: boolean;
  full?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  gold: 'bg-gradient-to-b from-gold-300 via-gold-500 to-gold-600 text-felt-950 font-extrabold shadow-[0_10px_24px_-10px_rgba(212,175,55,.7)] hover:brightness-105 active:scale-[.98]',
  ghost: 'bg-white/8 text-ink-100 border border-white/12 hover:bg-white/12 active:scale-[.98]',
  dark: 'bg-felt-900/80 text-ink-100 border border-white/10 hover:bg-felt-800 active:scale-[.98]',
  danger: 'bg-gradient-to-b from-rose-500 to-rose-700 text-white font-bold active:scale-[.98]',
  success: 'bg-gradient-to-b from-emerald-400 to-emerald-600 text-felt-950 font-extrabold active:scale-[.98]',
  blue: 'bg-gradient-to-b from-sky-400 to-sky-600 text-felt-950 font-extrabold active:scale-[.98]',
};

const SIZES = { sm: 'px-3 py-1.5 text-sm rounded-xl', md: 'px-4 py-2.5 text-[15px] rounded-2xl', lg: 'px-6 py-3.5 text-base rounded-2xl' };

export function Button({ variant = 'ghost', size = 'md', icon, loading, full, className, children, onClick, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      onClick={(e) => {
        sfx('click');
        onClick?.(e);
      }}
      className={cn(
        'relative inline-flex items-center justify-center gap-2 transition-all disabled:opacity-45 disabled:pointer-events-none select-none',
        VARIANTS[variant],
        SIZES[size],
        full && 'w-full',
        className,
      )}
    >
      {loading ? <span className="size-4 rounded-full border-2 border-current border-t-transparent animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* ============================== لوحات ============================== */

export function Panel({ className, children, glow }: { className?: string; children: ReactNode; glow?: boolean }) {
  return (
    <div className={cn('glass rounded-3xl p-4 shadow-panel', glow && 'ring-1 ring-gold-500/40', className)}>{children}</div>
  );
}

export function SectionTitle({ icon, children, action }: { icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-lg font-bold text-ink-100">
        {icon}
        {children}
      </h2>
      {action}
    </div>
  );
}

/* ============================== نافذة ============================== */

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 'max-w-md',
  hideClose,
}: {
  open: boolean;
  onClose?: () => void;
  title?: ReactNode;
  children: ReactNode;
  maxWidth?: string;
  hideClose?: boolean;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => onClose?.()}
        >
          <motion.div
            className={cn('glass w-full overflow-hidden rounded-3xl shadow-panel', maxWidth)}
            initial={{ y: 40, scale: 0.96, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            {title && (
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div className="text-base font-bold">{title}</div>
                {!hideClose && (
                  <button className="rounded-xl px-2 py-1 text-ink-300 hover:bg-white/10" onClick={() => onClose?.()}>
                    ✕
                  </button>
                )}
              </div>
            )}
            <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ============================== تنبيهات ============================== */

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismiss);
  const colors: Record<string, string> = {
    info: 'border-white/15 bg-felt-900/95',
    success: 'border-emerald-400/40 bg-emerald-900/90',
    error: 'border-rose-400/40 bg-rose-900/90',
    gold: 'border-gold-500/50 bg-[#3a2f09]/95',
  };
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            layout
            initial={{ y: -30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            onClick={() => dismiss(t.id)}
            className={cn('pointer-events-auto w-full max-w-sm rounded-2xl border px-4 py-2.5 text-center text-sm font-semibold shadow-panel backdrop-blur', colors[t.kind])}
          >
            {t.text}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ============================== الصورة الرمزية ============================== */

export function Avatar({
  emoji,
  size = 48,
  frame,
  ring,
  className,
}: {
  emoji: string;
  size?: number;
  frame?: string | null;
  ring?: boolean;
  className?: string;
}) {
  const frameClass =
    frame === 'gold'
      ? 'ring-2 ring-gold-400 shadow-[0_0_18px_rgba(212,175,55,.55)]'
      : frame === 'fire'
        ? 'ring-2 ring-orange-400 shadow-[0_0_18px_rgba(251,146,60,.6)]'
        : 'ring-1 ring-white/15';
  return (
    <div
      className={cn('flex items-center justify-center rounded-full bg-gradient-to-b from-white/10 to-white/5', frameClass, ring && 'anim-turn-ring', className)}
      style={{ width: size, height: size, fontSize: size * 0.55 }}
    >
      <span>{emoji}</span>
    </div>
  );
}

/* ============================== شارات ============================== */

export function CoinBadge({ coins, className }: { coins: number; className?: string }) {
  return (
    <div className={cn('flex items-center gap-1.5 rounded-full border border-gold-500/40 bg-gold-500/10 px-3 py-1 text-sm font-bold text-gold-300', className)}>
      <span>🪙</span>
      <span>{new Intl.NumberFormat('en-US').format(coins)}</span>
    </div>
  );
}

export function LevelBadge({ level }: { level: number }) {
  return (
    <span className="rounded-full bg-gradient-to-b from-sky-400/90 to-sky-600 px-2 py-0.5 text-[11px] font-extrabold text-felt-950">
      مستوى {level}
    </span>
  );
}

export function XpBar({ into, need }: { into: number; need: number }) {
  const pct = Math.min(100, Math.round((into / Math.max(1, need)) * 100));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-gold-300 to-gold-600"
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      />
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-ink-300">
      <div className="size-8 animate-spin rounded-full border-[3px] border-gold-500/70 border-t-transparent" />
      {label && <div className="text-sm">{label}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <div className="text-4xl opacity-70">{icon}</div>
      <div className="font-bold">{title}</div>
      {hint && <div className="text-sm text-ink-300">{hint}</div>}
    </div>
  );
}

/** قصاصات احتفالية */
export function Confetti({ show }: { show: boolean }) {
  if (!show) return null;
  const colors = ['#d4af37', '#38bdf8', '#fb923c', '#22c55e', '#f5e3a3', '#ef4444'];
  const pieces = Array.from({ length: 34 }, (_, i) => i);
  return (
    <>
      {pieces.map((i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${Math.random() * 100}%`,
            background: colors[i % colors.length],
            animationDuration: `${1.5 + Math.random() * 1.3}s`,
            animationDelay: `${Math.random() * 0.6}s`,
          }}
        />
      ))}
    </>
  );
}
