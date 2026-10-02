import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api';
import { BottomNav, TopBar } from '../components/Nav';
import { Avatar, EmptyState, Panel, Spinner } from '../components/ui';
import type { LeaderboardPlayer } from '../game/types';
import { cn } from '../lib/utils';

export function LeaderboardScreen() {
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api<{ players: LeaderboardPlayer[] }>('leaderboard', { limit: 50 }, { method: 'GET', timeout: 15000 })
      .then((r) => setPlayers(r.players ?? []))
      .catch(() => setPlayers([]))
      .finally(() => setLoading(false));
  }, []);

  const medal = (rank: number) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`);

  return (
    <div className="screen-bg flex h-full flex-col">
      <TopBar title="المتصدّرون" />
      <div className="flex-1 overflow-y-auto px-3 pb-2">
        {loading && <Spinner label="جارٍ التحميل…" />}
        {!loading && players.length === 0 && <EmptyState icon="🏆" title="لا يوجد متصدرون بعد" hint="العب أول مباراة لتظهر هنا!" />}
        <div className="space-y-2">
          {players.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.4) }}
              className={cn('glass flex items-center gap-3 rounded-2xl p-3', p.rank <= 3 && 'ring-1 ring-gold-500/40')}
            >
              <div className="w-8 text-center text-lg font-black text-gold-300">{medal(p.rank)}</div>
              <Avatar emoji={p.avatar} size={42} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{p.name}</div>
                <div className="text-[11px] text-ink-300">
                  مستوى {p.level} • {p.wins} فوز من {p.played} • نسبة {p.winRate}%
                </div>
              </div>
              <div className="text-center">
                <div className="text-sm font-black text-gold-300">{p.xp}</div>
                <div className="text-[10px] text-ink-500">خبرة</div>
              </div>
            </motion.div>
          ))}
        </div>
        {!loading && players.length > 0 && (
          <Panel className="mt-3 text-center text-[11px] text-ink-300">
            ترتيب حسب نقاط الخبرة، ثم عدد مرات الفوز. اللاعبون الزوار لا يظهرون في القائمة.
          </Panel>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
