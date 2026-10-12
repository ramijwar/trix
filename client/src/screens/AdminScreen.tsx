import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { useNav } from '../lib/nav';
import { BottomNav, TopBar } from '../components/Nav';
import { Avatar, Button, EmptyState, Modal, SectionTitle, Spinner } from '../components/ui';
import { cn, fmt, timeAgo } from '../lib/utils';
import type { Tournament } from '../game/types';
import { TournamentEdit } from './TournamentEdit';

/* ============================ الأنواع ============================ */

interface AdminUser {
  id: number;
  username: string;
  name: string;
  avatar: string;
  level: number;
  xp?: number;
  coins: number;
  gamesPlayed: number;
  gamesWon: number;
  isGuest: boolean;
  isAdmin: boolean;
  banned: boolean;
  createdAt: number;
  lastSeen: number;
}

interface TodayRoom {
  id: string;
  code: string;
  name: string;
  hostId: number;
  status: string;
  game: string;
  seats: { seat: number; userId: number; name: string; avatar: string }[];
  createdAt: number;
  lastActivity: number;
}

interface TodayMatch {
  id: number;
  roomCode: string;
  game?: string;
  scoreA: number;
  scoreB: number;
  winnerTeam: number;
  rounds: number;
  names: string[];
  createdAt: number;
}

interface TodayLog {
  dayStart: number;
  players: AdminUser[];
  rooms: TodayRoom[];
  matches: TodayMatch[];
}

interface HistoryMatch {
  id: number;
  roomCode: string;
  game: string;
  target: number;
  scoreA: number;
  scoreB: number;
  winnerTeam: number;
  names: string[];
  winners: string[];
  rounds: number;
  duration: number;
  createdAt: number;
}

interface HistoryRoom {
  code: string;
  name: string;
  game: string;
  status: string;
  createdAt: number;
  lastActivity: number;
  finished: boolean;
  scoreA: number | null;
  scoreB: number | null;
  winnerTeam: number | null;
  players: string[];
}

interface HistoryData {
  matches: HistoryMatch[];
  rooms: HistoryRoom[];
  totals: { matches: number; rooms: number };
}

/** اسم الفائز في طاولة منتهية (فريقين في الطرنيب أو لاعب في التركس) */
function winnerLabel(r: HistoryRoom): string {
  const names = (r.players || []).filter((n) => n && n !== '-');
  if (names.length === 0 || r.winnerTeam === null) return '—';
  if (r.game === 'trix') {
    return names[r.winnerTeam] ?? '—';
  }
  const winners = names.filter((_, i) => i % 2 === r.winnerTeam);
  return winners.join(' و ') || '—';
}

const STATUS_AR: Record<string, string> = {
  registration: 'التسجيل مفتوح',
  running: 'التصفيات جارية',
  finished: 'منتهية',
  cancelled: 'ملغاة',
};

/* ============================ الشاشة ============================ */

export function AdminScreen() {
  const go = useNav((s) => s.go);
  const toast = useStore((s) => s.toast);
  const [tab, setTab] = useState<'today' | 'users' | 'tournaments' | 'history'>('today');
  const [log, setLog] = useState<TodayLog | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState('');
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [historyTab, setHistoryTab] = useState<'matches' | 'rooms'>('matches');
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editTournament, setEditTournament] = useState<Tournament | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      if (tab === 'today') {
        const res = await api<{ log: TodayLog }>('admin/today', {}, { method: 'GET' });
        setLog(res.log);
      } else if (tab === 'users') {
        const res = await api<{ users: AdminUser[] }>('admin/users', { q: query }, { method: 'GET' });
        setUsers(res.users);
      } else if (tab === 'history') {
        const res = await api<HistoryData>('admin/history', { limit: 60, offset: 0 }, { method: 'GET', timeout: 20000 });
        setHistory(res);
      } else {
        const res = await api<{ tournaments: Tournament[] }>('admin/tournaments', {}, { method: 'GET' });
        setTournaments(res.tournaments);
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }, [tab, query, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="screen-bg flex h-full flex-col">
      <TopBar title="🛡️ لوحة المدير" onBack={() => go('lobby')} />
      <div className="mx-2 mb-2 grid grid-cols-4 gap-1 rounded-2xl bg-black/40 p-1">
        {([
          ['today', 'اليوم'],
          ['users', 'المستخدمون'],
          ['tournaments', 'البطولات'],
          ['history', 'سجل الطاولات'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn('rounded-xl py-2 text-xs font-bold', tab === key ? 'bg-gold-500 text-felt-950' : 'text-ink-200')}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-2">
        {busy && <Spinner />}

        {/* ===== سجل اليوم ===== */}
        {!busy && tab === 'today' && log && (
          <>
            <div className="mb-3 grid grid-cols-3 gap-2">
              <Stat label="لاعبون اليوم" value={fmt(log.players.length)} />
              <Stat label="طاولات اليوم" value={fmt(log.rooms.length)} />
              <Stat label="مباريات اليوم" value={fmt(log.matches.length)} />
            </div>
            <SectionTitle icon={<span>🎮</span>}>اللاعبون النشطون اليوم</SectionTitle>
            <div className="mb-4 space-y-1.5">
              {log.players.length === 0 && <EmptyState icon="😴" title="لا لاعبين اليوم" />}
              {log.players.map((p) => (
                <div key={p.id} className="glass flex items-center gap-2 rounded-2xl px-3 py-2">
                  <Avatar emoji={p.avatar} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">
                      {p.name} {p.isAdmin && <span className="text-[10px] text-gold-300">مدير</span>}
                      {p.banned && <span className="text-[10px] text-rose-400"> موقوف</span>}
                    </div>
                    <div className="text-[10px] text-ink-400">
                      {p.username} • مستوى {p.level} • {p.gamesPlayed} مباراة
                    </div>
                  </div>
                  <span className="text-[10px] text-ink-400">{timeAgo(Math.max(0, Math.floor(Date.now() / 1000) - p.lastSeen))}</span>
                </div>
              ))}
            </div>

            <SectionTitle icon={<span>🪑</span>}>طاولات اليوم</SectionTitle>
            <div className="mb-4 space-y-1.5">
              {log.rooms.length === 0 && <EmptyState icon="🃏" title="لا طاولات اليوم" />}
              {log.rooms.map((r) => (
                <div key={r.id} className="glass rounded-2xl px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">
                      {r.game === 'trix' ? '🧩' : '🃏'} {r.name}
                    </span>
                    <span className="font-mono text-xs text-gold-300" dir="ltr">
                      {r.code}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-ink-300">
                    {r.seats.map((s) => (
                      <span key={s.seat} className="rounded-full bg-black/30 px-2 py-0.5">
                        {s.avatar} {s.name}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 text-[10px] text-ink-500">
                    {r.status === 'finished' ? 'انتهت' : r.status === 'playing' ? 'جارية' : 'بالانتظار'} •{' '}
                    {timeAgo(Math.max(0, Math.floor(Date.now() / 1000) - r.lastActivity))}
                  </div>
                </div>
              ))}
            </div>

            <SectionTitle icon={<span>🏁</span>}>مباريات منتهية اليوم</SectionTitle>
            <div className="space-y-1.5">
              {log.matches.length === 0 && <EmptyState icon="📋" title="لا مباريات منتهية اليوم" />}
              {log.matches.map((m) => (
                <div key={m.id} className="glass flex items-center justify-between rounded-2xl px-3 py-2 text-xs">
                  <span className="font-mono text-ink-300" dir="ltr">
                    {m.roomCode}
                  </span>
                  <span className="text-[10px] font-bold">
                    {m.game === 'trix' ? '🧩 تركس' : '🃏 طرنيب'}
                  </span>
                  <span className="font-bold">
                    {m.scoreA} — {m.scoreB}
                  </span>
                  <span className="text-[10px] text-ink-500">
                    {m.rounds} جولة • الفريق {m.winnerTeam === 0 ? 'الأزرق' : 'البرتقالي'}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ===== المستخدمون ===== */}
        {!busy && tab === 'users' && (
          <>
            <div className="mb-2 flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ابحث بالاسم أو اسم المستخدم…"
                className="flex-1 rounded-2xl border border-white/12 bg-black/30 px-3 py-2 text-sm outline-none"
              />
              <Button variant="ghost" onClick={() => void load()}>
                بحث
              </Button>
            </div>
            <div className="space-y-1.5">
              {users.map((u) => (
                <div key={u.id} className="glass rounded-2xl px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Avatar emoji={u.avatar} size={34} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">
                        {u.name} {u.isAdmin && <span className="text-[10px] text-gold-300">مدير</span>}
                        {u.banned && <span className="text-[10px] text-rose-400"> موقوف</span>}
                      </div>
                      <div className="text-[10px] text-ink-400">
                        {u.username} • مستوى {u.level} • 🪙 {fmt(u.coins)} • {u.gamesWon}/{u.gamesPlayed} فوز
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <MiniBtn onClick={() => setEditUser(u)}>✏️ تعديل</MiniBtn>
                    <MiniBtn onClick={() => void act(u.id, 'coins', { amount: 500 })}>+500 🪙</MiniBtn>
                    <MiniBtn onClick={() => void act(u.id, 'coins', { amount: -500 })}>−500 🪙</MiniBtn>
                    <MiniBtn onClick={() => void act(u.id, u.isAdmin ? 'remove_admin' : 'make_admin')}>
                      {u.isAdmin ? 'إزالة الإدارة' : 'ترقية مدير'}
                    </MiniBtn>
                    <MiniBtn onClick={() => void act(u.id, u.banned ? 'unban' : 'ban')}>{u.banned ? 'إلغاء الإيقاف' : 'إيقاف'}</MiniBtn>
                    <MiniBtn
                      onClick={() => {
                        if (!window.confirm(`حذف المستخدم «${u.name}» نهائياً؟`)) return;
                        void act(u.id, 'delete');
                      }}
                    >
                      🗑 حذف
                    </MiniBtn>
                  </div>
                </div>
              ))}
              {users.length === 0 && <EmptyState icon="🔍" title="لا نتائج" />}
            </div>
          </>
        )}

        {/* ===== البطولات ===== */}
        {!busy && tab === 'tournaments' && (
          <>
            <Button variant="gold" full className="mb-3" onClick={() => setCreateOpen(true)}>
              ➕ إضافة بطولة
            </Button>
            <div className="space-y-2">
              {tournaments.length === 0 && <EmptyState icon="🏆" title="لا بطولات بعد" hint="أضف بطولة وحدد عدد المشاركين وموعد البدء" />}
              {tournaments.map((t) => (
                <TournamentCard
                  key={t.id}
                  t={t}
                  isAdmin
                  onEdit={() => setEditTournament(t)}
                  onDelete={() => {
                    if (!window.confirm(`حذف بطولة «${t.name}» نهائياً؟`)) return;
                    void adminRun('admin/tournament/delete', { id: t.id });
                  }}
                  onAction={async (route, body) => {
                    await adminRun(route, { id: t.id, ...body });
                  }}
                />
              ))}
            </div>
          </>
        )}
        {/* ===== سجل الطاولات الكامل ===== */}
        {!busy && tab === 'history' && history && (
          <>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <Stat label="إجمالي المباريات" value={fmt(history.totals.matches)} />
              <Stat label="إجمالي الطاولات" value={fmt(history.totals.rooms)} />
            </div>
            <div className="mb-2 grid grid-cols-2 gap-1 rounded-2xl bg-black/40 p-1">
              {(
                [
                  ['matches', '🏁 نتائج المباريات'],
                  ['rooms', '🪑 كل الطاولات'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setHistoryTab(k)}
                  className={cn('rounded-xl py-1.5 text-[11px] font-bold', historyTab === k ? 'bg-gold-500 text-felt-950' : 'text-ink-200')}
                >
                  {label}
                </button>
              ))}
            </div>

            {historyTab === 'matches' && (
              <div className="space-y-1.5">
                {history.matches.length === 0 && <EmptyState icon="📋" title="لا مباريات مسجّلة" />}
                {history.matches.map((m) => (
                  <div key={m.id} className="glass rounded-2xl px-3 py-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono text-ink-300" dir="ltr">
                        {m.roomCode}
                      </span>
                      <span className="font-bold">{m.game === 'trix' ? '🧩 تركس' : '🃏 طرنيب'}</span>
                      <span className="text-ink-400">
                        {new Date(m.createdAt * 1000).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-xs font-black">
                        {m.scoreA} — {m.scoreB}
                      </span>
                      <span className="text-[10px] text-ink-400">{m.rounds} جولة</span>
                    </div>
                    <div className="mt-1 rounded-xl bg-emerald-600/20 px-2 py-1 text-[11px] font-bold text-emerald-200">
                      🏆 الفائز: {m.winners.filter(Boolean).join(' و ') || '—'}
                    </div>
                    <div className="mt-1 text-[10px] text-ink-400">
                      اللاعبون: {m.names.filter((n) => n && n !== '-').join(' • ')}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {historyTab === 'rooms' && (
              <div className="space-y-1.5">
                {history.rooms.length === 0 && <EmptyState icon="🪑" title="لا طاولات" />}
                {history.rooms.map((r) => (
                  <div key={r.code} className="glass rounded-2xl px-3 py-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="truncate font-bold">
                        {r.game === 'trix' ? '🧩' : '🃏'} {r.name}
                      </span>
                      <span className="font-mono text-gold-300" dir="ltr">
                        {r.code}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between text-[10px] text-ink-400">
                      <span>
                        {r.status === 'finished' ? 'انتهت ✅' : r.status === 'playing' ? 'جارية' : r.status === 'closed' ? 'أُغلقت' : 'بالانتظار'}
                      </span>
                      <span>
                        {new Date(r.createdAt * 1000).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </div>
                    {r.finished ? (
                      <div className="mt-1 text-[11px]">
                        <span className="font-black">
                          {r.scoreA} — {r.scoreB}
                        </span>
                        <span className="mr-2 text-emerald-200">🏆 {winnerLabel(r)}</span>
                      </div>
                    ) : (
                      <div className="mt-1 text-[10px] text-ink-500">لا نتيجة مسجّلة</div>
                    )}
                    {r.players.length > 0 && (
                      <div className="mt-1 text-[10px] text-ink-400">{r.players.filter((n) => n && n !== '-').join(' • ')}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <CreateTournament
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onDone={async () => {
          setCreateOpen(false);
          await load();
          toast('أُضيفت البطولة 🏆', 'success');
        }}
      />
      <UserEdit
        user={editUser}
        onClose={() => setEditUser(null)}
        onDone={async () => {
          setEditUser(null);
          await load();
        }}
      />
      <TournamentEdit
        key={editTournament?.id ?? 0}
        tournament={editTournament}
        onClose={() => setEditTournament(null)}
        onDone={async () => {
          setEditTournament(null);
          await load();
        }}
      />
      <BottomNav />
    </div>
  );

  /** تنفيذ أمر إداري مع توست + إعادة تحميل */
  async function adminRun(route: string, body: Record<string, unknown>) {
    try {
      await api(route, body);
      toast('تم التنفيذ ✅', 'success');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function act(id: number, action: string, extra: Record<string, unknown> = {}) {
    try {
      await api('admin/user/action', { id, action, ...extra });
      toast('تم التنفيذ ✅', 'success');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
}

/* ============================ مكوّنات صغيرة ============================ */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-2xl px-3 py-2 text-center">
      <div className="text-lg font-black text-gold-300">{value}</div>
      <div className="text-[10px] text-ink-300">{label}</div>
    </div>
  );
}

function MiniBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-full bg-white/8 px-2.5 py-1 text-[11px] font-bold hover:bg-white/15">
      {children}
    </button>
  );
}

export function TournamentCard({
  t,
  isAdmin,
  onAction,
  onEdit,
  onDelete,
}: {
  t: Tournament;
  isAdmin?: boolean;
  onAction: (route: string, body: Record<string, unknown>) => void | Promise<void>;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const openTournament = useNav((s) => s.openTournament);
  const open = () => openTournament(t.id);
  const now = Math.floor(Date.now() / 1000);
  const left = t.startAt - now;
  return (
    <div className="glass rounded-2xl p-3">
      <div className="flex items-center justify-between gap-2">
        <button onClick={open} className="min-w-0 flex-1 text-right">
          <div className="truncate text-sm font-black">
            {t.game === 'trix' ? '🧩' : '🃏'} {t.name}
          </div>
          <div className="text-[10px] text-ink-400">
            {STATUS_AR[t.status] ?? t.status} • {t.playersCount}/{t.capacity} مشارك
            {t.status === 'running' ? ` • الدور ${t.round}` : ''}
          </div>
        </button>
        <span className="font-mono text-xs text-gold-300" dir="ltr">
          {t.code}
        </span>
      </div>

      <div className="mt-1 text-[10px] text-ink-400">
        البدء: {new Date(t.startAt * 1000).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}
        {t.status === 'registration' && left > 0 ? ` (بعد ${Math.ceil(left / 60)} دقيقة)` : ''}
      </div>

      {t.winners.length > 0 && (
        <div className="mt-2 rounded-xl bg-gold-500/15 px-2 py-1.5 text-[11px] font-bold text-gold-200">
          {t.winners.map((w) => (
            <div key={w.place}>
              {w.place === 1 ? '🥇 المرتبة الأولى' : '🥈 المرتبة الثانية'}: {w.avatar} {w.name}
            </div>
          ))}
        </div>
      )}

      {t.matches.length > 0 && (
        <div className="mt-2 space-y-1">
          {t.matches.map((m) => (
            <div key={m.id} className="rounded-xl bg-black/25 px-2 py-1 text-[10px] text-ink-300">
              <span className="font-bold text-ink-100">دور {m.round}</span> • {m.status === 'done' ? 'انتهت' : 'جارية'} •{' '}
              <span className="font-mono" dir="ltr">
                {m.roomCode}
              </span>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {m.seats.map((s, i) => (
                  <span key={i} className={cn('rounded-full px-1.5 py-0.5', m.winnerSeat === i ? 'bg-emerald-600/40' : 'bg-black/30')}>
                    {s.avatar} {s.name}
                    {s.isBot ? ' 🤖' : ''}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1">
        <MiniBtn onClick={open}>👁 شاشة البطولة</MiniBtn>
        {isAdmin ? (
          <>
            {t.status !== 'running' && t.status !== 'finished' && (
              <MiniBtn onClick={() => void onAction('admin/tournament/start', {})}>▶️ بدء التصفيات</MiniBtn>
            )}
            {t.status === 'running' && <MiniBtn onClick={() => void onAction('admin/tournament/advance', {})}>🔄 تحديث الدور التالي</MiniBtn>}
            {onEdit && <MiniBtn onClick={onEdit}>✏️ تعديل</MiniBtn>}
            {t.status !== 'finished' && t.status !== 'cancelled' && (
              <MiniBtn
                onClick={() => {
                  if (!window.confirm(`إلغاء بطولة «${t.name}»؟ ستختفي من عند اللاعبين فوراً.`)) return;
                  void onAction('admin/tournament/status', { status: 'cancelled' });
                }}
              >
                ✖️ إلغاء
              </MiniBtn>
            )}
            {onDelete && <MiniBtn onClick={onDelete}>🗑 حذف</MiniBtn>}
          </>
        ) : (
          <>
            {t.status === 'registration' && !t.joined && <MiniBtn onClick={() => void onAction('tournament/join', { id: t.id })}>✋ سجّلني</MiniBtn>}
            {t.joined && t.status === 'registration' && <MiniBtn onClick={() => void onAction('tournament/leave', { id: t.id })}>🚪 انسحاب</MiniBtn>}
            {t.joined && t.status === 'running' && <span className="rounded-full bg-emerald-600/30 px-2 py-1 text-[11px] font-bold">أنت مشارك</span>}
          </>
        )}
      </div>
    </div>
  );
}

/* ============================ تعديل مستخدم ============================ */

function UserEdit({ user, onClose, onDone }: { user: AdminUser | null; onClose: () => void; onDone: () => void }) {
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState(user?.name ?? '');
  const [avatar, setAvatar] = useState(user?.avatar ?? '');
  const [coins, setCoins] = useState(user?.coins ?? 0);
  const [xp, setXp] = useState(user?.xp ?? 0);
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(Boolean(user?.isAdmin));
  const [banned, setBanned] = useState(Boolean(user?.banned));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setAvatar(user.avatar);
    setCoins(user.coins);
    setXp(user.xp ?? 0);
    setPassword('');
    setIsAdmin(Boolean(user.isAdmin));
    setBanned(Boolean(user.banned));
  }, [user]);

  const save = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await api('admin/user/update', {
        id: user.id,
        name,
        avatar,
        coins,
        xp,
        is_admin: isAdmin,
        banned,
      });
      if (password.trim().length >= 4) {
        await api('admin/user/action', { id: user.id, action: 'password', password: password.trim() });
      }
      toast('تم تحديث المستخدم ✅', 'success');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={Boolean(user)} onClose={onClose} title={`✏️ ${user?.username ?? ''}`}>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Avatar emoji={avatar || '🙂'} size={48} />
          <div className="flex-1">
            <div className="mb-1 text-xs text-ink-300">الاسم الظاهر</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-2xl border border-white/12 bg-black/30 px-3 py-2 outline-none"
            />
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs text-ink-300">الصورة (إيموجي)</div>
          <input
            value={avatar}
            onChange={(e) => setAvatar(e.target.value)}
            className="w-full rounded-2xl border border-white/12 bg-black/30 px-3 py-2 text-center text-lg outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1 text-xs text-ink-300">العملات 🪙</div>
            <input
              type="number"
              value={coins}
              onChange={(e) => setCoins(Number(e.target.value))}
              className="w-full rounded-2xl border border-white/12 bg-black/30 px-3 py-2 text-center outline-none"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-ink-300">الخبرة XP</div>
            <input
              type="number"
              value={xp}
              onChange={(e) => setXp(Number(e.target.value))}
              className="w-full rounded-2xl border border-white/12 bg-black/30 px-3 py-2 text-center outline-none"
            />
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs text-ink-300">كلمة مرور جديدة (اتركها فارغة إن لم تُرد التغيير)</div>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••"
            className="w-full rounded-2xl border border-white/12 bg-black/30 px-3 py-2 outline-none"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setIsAdmin((v) => !v)}
            className={cn('flex-1 rounded-2xl py-2 text-sm font-bold', isAdmin ? 'bg-gold-500 text-felt-950' : 'bg-white/8')}
          >
            {isAdmin ? 'مدير ✅' : 'ترقية لمدير'}
          </button>
          <button
            onClick={() => setBanned((v) => !v)}
            className={cn('flex-1 rounded-2xl py-2 text-sm font-bold', banned ? 'bg-rose-600 text-white' : 'bg-white/8')}
          >
            {banned ? 'موقوف 🚫' : 'إيقاف الحساب'}
          </button>
        </div>
        <Button variant="gold" full loading={busy} onClick={() => void save()}>
          حفظ التعديلات
        </Button>
      </div>
    </Modal>
  );
}

/* ============================ إنشاء بطولة ============================ */

function CreateTournament({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState('بطولة التركس');
  const [game, setGame] = useState<'tarnib' | 'trix'>('tarnib');
  const [capacity, setCapacity] = useState(8);
  const [minutes, setMinutes] = useState(10);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api('admin/tournament/create', {
        tournament: { name, game, capacity, startAt: Math.floor(Date.now() / 1000) + minutes * 60 },
      });
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="🏆 بطولة جديدة">
      <div className="space-y-3">
        <div>
          <div className="mb-1 text-xs text-ink-300">اسم البطولة</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-2xl border border-white/12 bg-black/30 px-3 py-2.5 outline-none"
          />
        </div>
        <div>
          <div className="mb-1 text-xs text-ink-300">اللعبة</div>
          <div className="grid grid-cols-2 gap-2">
            {([
              ['tarnib', '🃏 طرنيب'],
              ['trix', '🧩 تركس'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setGame(k)}
                className={cn('rounded-2xl py-2 text-sm font-bold', game === k ? 'bg-gold-500 text-felt-950' : 'bg-white/8')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs text-ink-300">عدد المشاركين (مضاعفات ٤ — ٤ إلى ٦٤)</div>
          <input
            type="number"
            min={4}
            max={64}
            step={4}
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
            className="w-full rounded-2xl border border-white/12 bg-black/30 px-3 py-2.5 text-center outline-none"
          />
        </div>
        <div>
          <div className="mb-1 text-xs text-ink-300">موعد البدء (بعد كم دقيقة)</div>
          <input
            type="number"
            min={1}
            max={1440}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="w-full rounded-2xl border border-white/12 bg-black/30 px-3 py-2.5 text-center outline-none"
          />
        </div>
        <Button variant="gold" full loading={busy} onClick={() => void submit()}>
          إنشاء البطولة
        </Button>
      </div>
    </Modal>
  );
}

/* ============================ قائمة بطولات اللاعب (في الردهة) ============================ */

export function TournamentsPanel() {
  const [items, setItems] = useState<Tournament[]>([]);
  const [mine, setMine] = useState<Tournament[]>([]);
  const toast = useStore((s) => s.toast);

  const load = useCallback(async () => {
    try {
      const res = await api<{ tournaments: Tournament[]; mine: Tournament[] }>('tournaments', {}, { method: 'GET' });
      setItems(res.tournaments ?? []);
      setMine(res.mine ?? []);
    } catch {
      /* تجاهل */
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30000);
    return () => clearInterval(id);
  }, [load]);

  if (items.length === 0 && mine.length === 0) return null;

  const onlyMine = mine.filter((t) => !items.some((i) => i.id === t.id));
  const act = async (route: string, body: Record<string, unknown>) => {
    try {
      await api(route, body);
      toast('تم ✅', 'success');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <>
      {mine.length > 0 && (
        <>
          <SectionTitle icon={<span>⭐</span>}>بطولاتي</SectionTitle>
          <div className="mb-4 space-y-2">
            {mine.map((t) => (
              <TournamentCard key={t.id} t={t} onAction={act} />
            ))}
          </div>
        </>
      )}

      {items.length > 0 && (
        <>
          <SectionTitle icon={<span>🏆</span>}>
            {mine.length > 0 ? 'بطولات أخرى' : 'البطولات'} (اضغط البطولة لشاشة الانتظار)
          </SectionTitle>
          <div className="mb-4 space-y-2">
            {[...onlyMine.filter((t) => !mine.some((m) => m.id === t.id)), ...items].map((t) => (
              <TournamentCard key={t.id} t={t} onAction={act} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
