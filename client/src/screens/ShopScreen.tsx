import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { BottomNav, TopBar } from '../components/Nav';
import { Button, Panel, SectionTitle, Spinner } from '../components/ui';
import type { ShopItem } from '../game/types';
import { cn } from '../lib/utils';

interface Inventory {
  owned?: string[];
  equipped?: Record<string, string>;
}

const TYPE_LABEL: Record<string, string> = { cardBack: 'أشكال ظهر الورق', tableTheme: 'أنماط الطاولة', frame: 'إطارات الصورة' };

export function ShopScreen() {
  const toast = useStore((s) => s.toast);
  const refreshUser = useStore((s) => s.refreshUser);
  const [items, setItems] = useState<ShopItem[]>([]);
  const [inventory, setInventory] = useState<Inventory>({});
  const [coins, setCoins] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const load = async () => {
    try {
      const res = await api<{ items: ShopItem[]; inventory: Inventory; coins: number }>('shop', {}, { method: 'GET', timeout: 15000 });
      setItems(res.items ?? []);
      setInventory(res.inventory ?? {});
      setCoins(res.coins ?? 0);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const buy = async (item: ShopItem) => {
    setBusy(item.id);
    try {
      const res = await api<{ user: { coins: number } }>('shop/buy', { item: item.id });
      toast(`تم الشراء: ${item.name} ✅`, 'success');
      setCoins(res.user.coins);
      await load();
      await refreshUser();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  };

  const equip = async (item: ShopItem) => {
    setBusy(item.id);
    try {
      await api('shop/equip', { type: item.type, value: item.value });
      toast(`تم التجهيز: ${item.name}`, 'success');
      await load();
      await refreshUser();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  };

  const owned = new Set(inventory.owned ?? []);
  const groups = ['cardBack', 'tableTheme', 'frame'] as const;

  return (
    <div className="screen-bg flex h-full flex-col">
      <TopBar title="المتجر" />
      <div className="flex-1 overflow-y-auto px-3 pb-2">
        <Panel className="mb-3 flex items-center justify-between">
          <span className="text-sm text-ink-300">رصيدك</span>
          <span className="text-xl font-black text-gold-300">🪙 {new Intl.NumberFormat('en-US').format(coins)}</span>
        </Panel>

        {loading && <Spinner label="جارٍ تحميل المتجر…" />}

        {groups.map((type) => {
          const group = items.filter((i) => i.type === type);
          if (!group.length) return null;
          return (
            <div key={type} className="mb-4">
              <SectionTitle icon={<span>🛍️</span>}>{TYPE_LABEL[type]}</SectionTitle>
              <div className="grid grid-cols-2 gap-2">
                {group.map((item) => {
                  const isOwned = owned.has(item.id);
                  const isEquipped = inventory.equipped?.[item.type] === item.value;
                  return (
                    <div key={item.id} className={cn('glass rounded-2xl p-3 text-center', isEquipped && 'ring-2 ring-gold-400/70')}>
                      <div className="text-3xl">{item.icon}</div>
                      <div className="mt-1 text-xs font-bold">{item.name}</div>
                      <div className="mb-2 mt-0.5 text-[11px] text-ink-300">{item.price === 0 ? 'مجاني' : `🪙 ${item.price}`}</div>
                      {isEquipped ? (
                        <div className="rounded-xl bg-gold-500/20 py-1.5 text-[11px] font-bold text-gold-300">مُجهّز ✓</div>
                      ) : isOwned ? (
                        <Button size="sm" variant="ghost" full loading={busy === item.id} onClick={() => void equip(item)}>
                          تجهيز
                        </Button>
                      ) : (
                        <Button size="sm" variant="gold" full loading={busy === item.id} disabled={coins < item.price && item.price > 0} onClick={() => void buy(item)}>
                          {item.price === 0 ? 'احصل عليه' : 'شراء'}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <BottomNav />
    </div>
  );
}
