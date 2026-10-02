import { useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../lib/store';
import { useNav } from '../lib/nav';
import { isNative } from '../lib/api';
import { Button, Panel } from '../components/ui';
import { cn } from '../lib/utils';

const AVATARS = ['🦊', '🐺', '🦁', '🐯', '🐻', '🐼', '🐨', '🐸', '🦅', '🦉', '🐬', '🦈', '😎', '🧔', '👳', '🧕'];

export function AuthScreen() {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('🦊');
  const [busy, setBusy] = useState<'login' | 'register' | 'guest' | ''>('');
  const register = useStore((s) => s.register);
  const login = useStore((s) => s.login);
  const guest = useStore((s) => s.guest);
  const toast = useStore((s) => s.toast);
  const go = useNav((s) => s.go);

  const submit = async () => {
    if (username.trim().length < 3) {
      toast('اسم المستخدم يجب أن يكون 3 أحرف على الأقل', 'error');
      return;
    }
    if (password.length < 4) {
      toast('كلمة المرور يجب أن تكون 4 أحرف على الأقل', 'error');
      return;
    }
    setBusy(tab);
    try {
      if (tab === 'login') {
        await login(username.trim(), password);
        toast('أهلاً بعودتك 👋', 'success');
      } else {
        await register(username.trim(), password, name.trim() || username.trim(), avatar);
        toast('تم إنشاء الحساب — بالتوفيق 🎉', 'success');
      }
      go('lobby');
    } catch (e) {
      const err = e as { message?: string; code?: string };
      if (err.code === 'network' || err.code === 'timeout') {
        toast('تعذّر الاتصال بالخادم', 'error');
      } else {
        toast(err.message ?? 'حدث خطأ', 'error');
      }
    } finally {
      setBusy('');
    }
  };

  const asGuest = async () => {
    setBusy('guest');
    try {
      await guest();
      toast('مرحباً بك كزائر — العب فوراً 🚀', 'success');
      go('lobby');
    } catch {
      toast('تعذّر الدخول كزائر', 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="screen-bg relative flex h-full flex-col items-center justify-center overflow-hidden p-4">
      {/* أوراق متطايرة في الخلفية */}
      {[...Array(6)].map((_, i) => (
        <motion.div
          key={i}
          className="pointer-events-none absolute text-3xl opacity-20"
          initial={{ x: `${(i * 17) % 90}%`, y: '-10%', rotate: 0 }}
          animate={{ y: '110%', rotate: 360 }}
          transition={{ duration: 12 + i * 3, repeat: Infinity, delay: i * 1.6, ease: 'linear' }}
        >
          {['🃏', '♠️', '♥️', '♦️', '♣️', '🎴'][i]}
        </motion.div>
      ))}

      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="relative z-10 mb-5 text-center"
      >
        <div className="anim-float text-5xl">🃏</div>
        <h1 className="gold-text mt-2 text-3xl font-black tracking-tight">طرنيب أونلاين</h1>
        <p className="mt-1 text-sm text-ink-300">لعبة الورق الأكثر شعبية — 4 لاعبين، شركاء متقابلين</p>
      </motion.div>

      <Panel className="relative z-10 w-full max-w-sm" glow>
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-black/25 p-1">
          {(['login', 'register'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'rounded-xl py-2 text-sm font-bold transition',
                tab === t ? 'bg-gradient-to-b from-gold-300 to-gold-600 text-felt-950' : 'text-ink-300',
              )}
            >
              {t === 'login' ? 'تسجيل الدخول' : 'حساب جديد'}
            </button>
          ))}
        </div>

        {tab === 'register' && (
          <div className="mb-3">
            <label className="mb-1.5 block text-xs text-ink-300">اختر صورتك</label>
            <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  onClick={() => setAvatar(a)}
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-full bg-white/8 text-xl transition',
                    avatar === a && 'ring-2 ring-gold-400 scale-110',
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-ink-300">اسم المستخدم</label>
            <input
              dir="ltr"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="player123"
              className="w-full rounded-2xl border border-white/12 bg-black/30 px-3 py-2.5 text-left outline-none transition focus:border-gold-500/60"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-300">كلمة المرور</label>
            <input
              dir="ltr"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              className="w-full rounded-2xl border border-white/12 bg-black/30 px-3 py-2.5 text-left outline-none transition focus:border-gold-500/60"
            />
          </div>
          {tab === 'register' && (
            <div>
              <label className="mb-1 block text-xs text-ink-300">الاسم المعروض (اختياري)</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: أبو خالد"
                className="w-full rounded-2xl border border-white/12 bg-black/30 px-3 py-2.5 outline-none transition focus:border-gold-500/60"
              />
            </div>
          )}

          <Button variant="gold" size="lg" full loading={busy === tab} onClick={() => void submit()}>
            {tab === 'login' ? 'دخول' : 'إنشاء الحساب'}
          </Button>
          <Button variant="ghost" full loading={busy === 'guest'} onClick={() => void asGuest()}>
            🚀 العب كزائر (بدون تسجيل)
          </Button>
        </div>
      </Panel>

      <div className="relative z-10 mt-4 flex flex-col items-center gap-2">
        <p className="text-center text-[11px] leading-relaxed text-ink-500">
          بالدخول أنت توافق على قوانين اللعب والروح الرياضية.
          <br />
          لا تُشارك كلمة مرورك مع أي شخص.
        </p>
        {isNative() && (
          <button
            onClick={() => useStore.setState({ needsServerSetup: true })}
            className="text-[11px] text-ink-500 underline"
          >
            تغيير عنوان الخادم
          </button>
        )}
      </div>
    </div>
  );
}
