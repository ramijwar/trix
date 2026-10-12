import { useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, Modal } from '../components/ui';
import type { Tournament } from '../game/types';
import { cn } from '../lib/utils';

/** تعديل بطولة موجودة: الاسم، اللعبة، عدد المشاركين، وموعد البدء */
export function TournamentEdit({
  tournament,
  onClose,
  onDone,
}: {
  tournament: Tournament | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useStore((s) => s.toast);
  const t = tournament;
  const [name, setName] = useState(t?.name ?? '');
  const [game, setGame] = useState<'tarnib' | 'trix'>(t?.game === 'trix' ? 'trix' : 'tarnib');
  const [capacity, setCapacity] = useState(t?.capacity ?? 8);
  const [when, setWhen] = useState(() => {
    if (!t) return Math.floor(Date.now() / 1000) + 600;
    return t.startAt;
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!t) return;
    setBusy(true);
    try {
      await api('admin/tournament/update', {
        id: t.id,
        tournament: { name, game, capacity, startAt: when },
      });
      toast('تم تعديل البطولة ✅', 'success');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const localDate = new Date(when * 1000);

  return (
    <Modal open={Boolean(t)} onClose={onClose} title={`✏️ تعديل: ${t?.name ?? ''}`}>
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
            {(
              [
                ['tarnib', '🃏 طرنيب'],
                ['trix', '🧩 تركس'],
              ] as const
            ).map(([k, label]) => (
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
          <div className="mb-1 text-xs text-ink-300">موعد البدء</div>
          <input
            type="datetime-local"
            value={new Date(localDate.getTime() - localDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              setWhen(Math.floor(new Date(v).getTime() / 1000));
            }}
            className="w-full rounded-2xl border border-white/12 bg-black/30 px-3 py-2.5 outline-none"
            dir="ltr"
          />
        </div>
        <Button variant="gold" full loading={busy} onClick={() => void save()}>
          حفظ التعديلات
        </Button>
      </div>
    </Modal>
  );
}
