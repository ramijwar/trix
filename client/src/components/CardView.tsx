import { motion } from 'framer-motion';
import { cn, cardRank, cardSuit, isRedCard } from '../lib/utils';
import { SUIT_SYMBOL } from '../game/types';

export type CardSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZES: Record<CardSize, { w: number; h: number; corner: string; center: string; radius: string }> = {
  xs: { w: 34, h: 48, corner: 'text-[9px]', center: 'text-[13px]', radius: 'rounded-[5px]' },
  sm: { w: 46, h: 66, corner: 'text-[11px]', center: 'text-[18px]', radius: 'rounded-md' },
  md: { w: 62, h: 90, corner: 'text-[13px]', center: 'text-[26px]', radius: 'rounded-lg' },
  lg: { w: 78, h: 112, corner: 'text-[15px]', center: 'text-[34px]', radius: 'rounded-xl' },
};

interface Props {
  code: string;
  size?: CardSize;
  faceDown?: boolean;
  back?: string;
  dim?: boolean;
  glow?: boolean;
  className?: string;
  onClick?: () => void;
  layoutId?: string;
  style?: React.CSSProperties;
}

export function CardView({ code, size = 'md', faceDown, back = 'red', dim, glow, className, onClick, layoutId, style }: Props) {
  const s = SIZES[size];
  const suit = cardSuit(code);
  const rank = cardRank(code);
  const red = isRedCard(code);

  return (
    <motion.div
      layoutId={layoutId}
      onClick={onClick}
      style={{ width: s.w, height: s.h, ...style }}
      className={cn(
        'playing-card select-none',
        faceDown ? cn('card-back', back) : red ? 'red' : 'black',
        s.radius,
        glow && 'shadow-[0_0_18px_rgba(212,175,55,.75)] ring-2 ring-gold-400/80',
        dim && 'opacity-45 saturate-50',
        onClick && 'cursor-pointer',
        className,
      )}
      whileTap={onClick ? { scale: 0.94 } : undefined}
      animate={{ scale: 1 }}
    >
      {!faceDown && (
        <>
          <div className={cn('absolute top-0.5 right-1 flex flex-col items-center leading-none font-bold', s.corner)}>
            <span>{rank}</span>
            <span>{SUIT_SYMBOL[suit]}</span>
          </div>
          <div className={cn('absolute inset-0 flex items-center justify-center font-black opacity-90', s.center)}>
            {SUIT_SYMBOL[suit]}
          </div>
          <div className={cn('absolute bottom-0.5 left-1 rotate-180 flex flex-col items-center leading-none font-bold', s.corner)}>
            <span>{rank}</span>
            <span>{SUIT_SYMBOL[suit]}</span>
          </div>
        </>
      )}
      {faceDown && (
        <div className="absolute inset-[3px] rounded-[inherit] border border-white/15 bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,.22),transparent_60%)]">
          <div className="flex h-full items-center justify-center text-white/70" style={{ fontSize: s.w * 0.4 }}>
            🃏
          </div>
        </div>
      )}
    </motion.div>
  );
}

/** ظهر ورقة صغير لعدّاد أوراق الخصم */
export function CardStack({ count, back = 'red', size = 'xs' }: { count: number; back?: string; size?: CardSize }) {
  const s = SIZES[size];
  return (
    <div className="relative" style={{ width: s.w + 10, height: s.h + 6 }}>
      {Array.from({ length: Math.min(4, count) }, (_, i) => (
        <div
          key={i}
          className={cn('playing-card card-back absolute', back, s.radius)}
          style={{ width: s.w, height: s.h, left: i * 3, top: i * 1.5, transform: `rotate(${(i - 1.5) * 3}deg)` }}
        />
      ))}
      <div className="absolute -bottom-5 inset-x-0 text-center text-[11px] font-bold text-ink-300">{count} ورقة</div>
    </div>
  );
}
