import { useState } from 'react';
import { useStore } from '../lib/store';
import { useNav } from '../lib/nav';
import { getServerUrl, isNative, pingServer, setServerUrl } from '../lib/api';
import { BottomNav, TopBar } from '../components/Nav';
import { Button, Panel, SectionTitle } from '../components/ui';
import { cn } from '../lib/utils';
import { sfx, voice } from '../lib/audio';

export function SettingsScreen() {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const toast = useStore((s) => s.toast);
  const user = useStore((s) => s.user);
  const logout = useStore((s) => s.logout);
  const go = useNav((s) => s.go);
  const [url, setUrl] = useState(getServerUrl());
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    const res = await pingServer(url);
    setChecking(false);
    if (res.ok) {
      setServerUrl(url);
      toast('تم الاتصال بالخادم ✅', 'success');
    } else {
      toast(res.error ?? 'فشل الاتصال', 'error');
    }
  };

  const rows: { key: 'sound' | 'voice' | 'vibration'; label: string; icon: string }[] = [
    { key: 'sound', label: 'المؤثرات الصوتية', icon: '🔊' },
    { key: 'voice', label: 'الأصوات المنطوقة (المعلّق)', icon: '🗣️' },
    { key: 'vibration', label: 'الاهتزاز', icon: '📳' },
  ];

  return (
    <div className="screen-bg flex h-full flex-col">
      <TopBar title="الإعدادات" onBack={() => go('lobby')} />
      <div className="flex-1 overflow-y-auto px-3 pb-2">
        <SectionTitle icon={<span>🎛️</span>}>الصوت والاهتزاز</SectionTitle>
        <div className="mb-4 space-y-2">
          {rows.map((r) => (
            <button
              key={r.key}
              onClick={() => {
                const value = !prefs[r.key];
                setPrefs({ [r.key]: value });
                if (r.key === 'sound' && value) sfx('gold');
                if (r.key === 'voice' && value) voice('welcome');
              }}
              className="glass flex w-full items-center justify-between rounded-2xl px-3 py-3"
            >
              <span className="flex items-center gap-2 text-sm font-bold">
                <span>{r.icon}</span>
                {r.label}
              </span>
              <span className={cn('flex h-6 w-11 items-center rounded-full px-0.5', prefs[r.key] ? 'justify-end bg-gold-500' : 'justify-start bg-white/15')}>
                <span className="size-5 rounded-full bg-white" />
              </span>
            </button>
          ))}
        </div>

        <SectionTitle icon={<span>🖥️</span>}>الخادم</SectionTitle>
        <Panel className="mb-4">
          <div className="text-[11px] text-ink-300">
            {isNative() ? 'عنوان خادم اللعبة (PHP)' : 'في المتصفح يتم الاتصال بنفس النطاق تلقائياً، ويمكنك تحديد خادم آخر هنا.'}
          </div>
          <input
            dir="ltr"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/trix"
            className="mt-2 w-full rounded-2xl border border-white/12 bg-black/30 px-3 py-2.5 text-left outline-none"
          />
          <Button variant="ghost" full className="mt-2" loading={checking} onClick={() => void check()}>
            فحص وحفظ
          </Button>
        </Panel>

        <SectionTitle icon={<span>ℹ️</span>}>حول اللعبة</SectionTitle>
        <Panel className="mb-4 space-y-1 text-xs leading-relaxed text-ink-300">
          <div className="font-bold text-ink-100">طرنيب أونلاين — الإصدار 1.0.0</div>
          <div>لعبة ورق عربية بين 4 لاعبين، الشركاء متقابلان. الطلب من 7 إلى 13، والهدف 31 (أو 41/61).</div>
          <div>الكبوت (13 أكلة) = +16، وطلب 13 ناجح = +26، وطلب 13 فاشل = −16 مع مضاعفة أكلات الخصم.</div>
          <div className="pt-1 text-ink-500">جميع الرسومات والأصوات أصلية ومصنوعة خصيصاً للتطبيق.</div>
        </Panel>

        {user && (
          <Button variant="danger" full onClick={() => void logout()}>
            تسجيل الخروج ({user.name})
          </Button>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
