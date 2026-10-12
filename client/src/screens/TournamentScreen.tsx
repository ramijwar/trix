import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { useNav } from '../lib/nav';
import { BottomNav } from '../components/Nav';
import { Avatar, Button, EmptyState, Panel, SectionTitle, Spinner } from '../components/ui';
import type { Tournament } from '../game/types';
import { cn } from '../lib/utils';

const STATUS_AR: Record<string, string> = {
  registration: 'التسجيل مفتوح',
  running: 'التصفيات جارية',
  finished: 'انتهت',
  cancelled: 'ملغاة',
};

/** ثانية → نص مختصر بالعربية (مثال: ٢٢ دقيقة) */
function countdownText(seconds: number): string {
  if (seconds <= 0) return 'الآن';
  const m = Math.floor(seconds / 60);
  if (m < 1) return `${seconds} ثانية`;
  if (m < 60) return `${m} دقيقة`;
  const h = Math.floor(m / 60);
  return `${h} ساعة${m % 60 ? ` و${m % 60} دقيقة` : ''}`;
}

/**
 * شاشة البطولة (شاشة انتظار):
 * - ترى المنظّم والمشاركين وحالة البطولة وموعد البدء.
 * - تسجيل/انسحاب قبل الانطلاق، ومتابعة التصفيات وطاولاتها بعد الانطلاق.
 * - تحديث تلقائي خفيف كل 5 ثوانٍ.
 */
export function TournamentScreen() {
  const toast = useStore((s) => s.toast);
  const me = useStore((s) => s.user);
  const go = useNav((s) => s.go);
  const enterRoom = useNav((s) => s.enterRoom);
  const id = useNav((s) => s.tournamentId);
  const [t, setT] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    try {
      const res = await api<{ tournament: Tournament }>('tournament/view', { id }, { method: 'GET', timeout: 15000 });
      setT(res.tournament ?? null);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), 5000);
    const clock = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load]);

  const act = async (route: string, extra: Record<string, unknown> = {}) => {
    setBusy(route);
    try {
      await api(route, { id, ...extra });
      toast('تم ✅', 'success');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  };

  /** الدخول إلى طاولة الدور الحالي (إن كنت من المشاركين فيها) */
  const enterMatch = async (code: string) => {
    setBusy('enter');
    try {
      const res = await api<{ room: { roomId: string; roomCode: string } }>('room/join', { room: code });
      enterRoom(res.room.roomId, res.room.roomCode);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="جارٍ تحميل البطولة…" />
      </div>
    );
  }

  if (!t) {
    return (
      <div className="flex h-full flex-col">
        <Header onBack={() => go('lobby')} title="البطولة" />
        <div className="flex-1 p-4">
          <EmptyState icon="🏆" title="البطولة غير متاحة" hint="ربما أُلغيت أو حُذفت من الإدارة" />
        </div>
        <BottomNav />
      </div>
    );
  }

  const left = t.startAt - now;
  const myId = me?.id ?? 0;

  return (
    <div className="flex h-full flex-col">
      <Header onBack={() => go('lobby')} title={t.name} />

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {/* حالة البطولة */}
        <Panel className="mb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-base font-black">
                {t.game === 'trix' ? '🧩 تركس' : '🃏 طرنيب'} — {t.name}
              </div>
              <div className="mt-0.5 text-[11px] text-ink-300">
                {STATUS_AR[t.status] ?? t.status} • {t.playersCount}/{t.capacity} مشارك
                {t.status === 'running' ? ` • الدور ${t.round}` : ''}
              </div>
            </div>
            <span className="shrink-0 font-mono text-xs text-gold-300" dir="ltr">
              {t.code}
            </span>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-xl bg-black/25 px-2 py-1.5">
              <div className="text-ink-400">موعد البدء</div>
              <div className="font-bold">
                {new Date(t.startAt * 1000).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}
              </div>
            </div>
            <div className="rounded-xl bg-black/25 px-2 py-1.5">
              <div className="text-ink-400">المتبقّي</div>
              <div className="font-bold text-gold-300">
                {t.status === 'registration' ? countdownText(left) : STATUS_AR[t.status] ?? '—'}
              </div>
            </div>
          </div>

          {/* المنظّم */}
          <div className="mt-2 flex items-center gap-2 rounded-xl bg-black/25 px-2 py-1.5">
            <Avatar emoji={t.organizer?.avatar ?? '🛡️'} size={30} />
            <div className="min-w-0">
              <div className="truncate text-xs font-bold">{t.organizer?.name ?? 'الإدارة'}</div>
              <div className="text-[10px] text-ink-400">منظّم البطولة</div>
            </div>
          </div>

          {/* أزرار التسجيل */}
          <div className="mt-2 flex flex-wrap gap-2">
            {t.status === 'registration' && !t.joined && (
              <Button variant="gold" loading={busy === 'tournament/join'} onClick={() => void act('tournament/join')}>
                ✋ سجّلني في البطولة
              </Button>
            )}
            {t.status === 'registration' && t.joined && (
              <>
                <span className="rounded-2xl bg-emerald-600/30 px-3 py-2 text-xs font-bold">أنت مسجّل ✅</span>
                <Button variant="ghost" loading={busy === 'tournament/leave'} onClick={() => void act('tournament/leave')}>
                  🚪 انسحاب
                </Button>
              </>
            )}
            {t.status !== 'registration' && t.joined && (
              <span className="rounded-2xl bg-sky-600/25 px-3 py-2 text-xs font-bold">أنت مشارك في البطولة 🎮</span>
            )}
          </div>
        </Panel>

        {/* نهاية البطولة */}
        {t.winners.length > 0 && (
          <Panel className="mb-3 border border-gold-400/40">
            <div className="text-sm font-black text-gold-200">🏆 نتيجة البطولة</div>
            {t.winners.map((w) => (
              <div key={w.place} className="mt-1 text-xs">
                {w.place === 1 ? '🥇 الأول' : '🥈 الثاني'}: {w.avatar} {w.name}
                {w.isBot ? ' 🤖' : ''}
              </div>
            ))}
          </Panel>
        )}

        {/* المشاركون */}
        <SectionTitle icon={<span>🧑‍🤝‍🧑</span>}>المشاركون ({t.playersCount})</SectionTitle>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {t.players.map((p) => (
            <div key={p.userId} className="glass flex items-center gap-2 rounded-2xl px-2 py-1.5">
              <Avatar emoji={p.avatar} size={28} />
              <div className="min-w-0">
                <div className="truncate text-xs font-bold">{p.name}</div>
                <div className="text-[10px] text-ink-400">
                  مستوى {p.level}
                  {p.place === 1 ? ' • 🥇' : p.place === 2 ? ' • 🥈' : ''}
                </div>
              </div>
            </div>
          ))}
          {t.players.length === 0 && (
            <div className="col-span-2">
              <EmptyState icon="🪑" title="لا مشاركين بعد" hint="كن أول المسجّلين!" />
            </div>
          )}
        </div>

        {/* الطاولات والتصفيات */}
        {t.matches.length > 0 && (
          <>
            <SectionTitle icon={<span>🎯</span>}>طاولات التصفيات</SectionTitle>
            <div className="space-y-2">
              {t.matches.map((m) => {
                const mine = myId > 0 && m.seats.some((s) => s.userId === myId && !s.isBot);
                return (
                  <div key={m.id} className="glass rounded-2xl px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold">دور {m.round}</span>
                      <span className="font-mono text-[11px] text-gold-300" dir="ltr">
                        {m.roomCode}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {m.seats.map((s, i) => (
                        <span
                          key={i}
                          className={cn(
                            'rounded-full px-1.5 py-0.5 text-[10px]',
                            m.winnerSeat === i ? 'bg-emerald-600/40 font-bold' : 'bg-black/30',
                          )}
                        >
                          {s.avatar} {s.name}
                          {s.isBot ? ' 🤖' : ''}
                        </span>
                      ))}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-ink-400">
                      <span>{m.status === 'done' ? 'انتهت ✅' : 'جارية الآن'}</span>
                      <button
                        onClick={() => void enterMatch(m.roomCode)}
                        disabled={busy === 'enter'}
                        className="rounded-full bg-white/10 px-2 py-0.5 font-bold text-ink-100 disabled:opacity-50"
                      >
                        {mine ? '🎮 ادخل طاولتك' : '👁 مشاهدة الطاولة'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {t.status === 'registration' && (
          <div className="mt-3 rounded-2xl bg-black/25 px-3 py-3 text-center text-[11px] text-ink-300">
            ⏳ شاشة انتظار: عندما يبدأ المنظّم التصفيات ستظهر طاولاتك هنا مباشرة — اترك الشاشة مفتوحة.
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="safe-top flex items-center gap-2 px-3 pb-2 pt-3">
      <button onClick={onBack} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm">
        ← رجوع
      </button>
      <div className="min-w-0 flex-1 truncate text-sm font-black">{title}</div>
    </header>
  );
}
