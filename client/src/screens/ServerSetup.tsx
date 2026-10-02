import { useState } from 'react';
import { motion } from 'framer-motion';
import { BUILT_IN_SERVER, pingServer, isNative } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, Panel } from '../components/ui';

/**
 * شاشة إعداد الخادم — تظهر في تطبيق الأندرويد عند أول تشغيل
 * (المتصفح لا يحتاجها لأنه يتصل بنفس النطاق)
 */
export function ServerSetupScreen() {
  const saveServer = useStore((s) => s.saveServer);
  const toast = useStore((s) => s.toast);
  const [url, setUrl] = useState(BUILT_IN_SERVER || 'https://');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const check = async () => {
    setChecking(true);
    setResult(null);
    const res = await pingServer(url);
    setChecking(false);
    if (res.ok) {
      setResult({ ok: true, text: `تم الاتصال بنجاح ✅${res.version ? ` — إصدار ${res.version}` : ''}` });
    } else {
      setResult({ ok: false, text: `فشل الاتصال: ${res.error ?? 'تحقق من العنوان'}` });
    }
  };

  const save = () => {
    if (!/^https?:\/\/.+/i.test(url.trim())) {
      toast('أدخل رابطاً يبدأ بـ http:// أو https://', 'error');
      return;
    }
    saveServer(url);
    toast('تم حفظ عنوان الخادم ✅', 'success');
  };

  return (
    <div className="screen-bg flex h-full flex-col items-center justify-center p-4">
      <Panel className="w-full max-w-sm" glow>
        <div className="mb-4 text-center">
          <div className="text-4xl">🖥️</div>
          <h1 className="mt-2 text-xl font-black">عنوان الخادم</h1>
          <p className="mt-1 text-sm leading-relaxed text-ink-300">
            أدخل رابط موقعك الذي رفعت عليه ملفات الخادم (مجلد <span dir="ltr">trix-api</span>).
            <br />
            مثال: <span dir="ltr" className="text-gold-300">https://example.com/trix</span>
          </p>
        </div>

        <input
          dir="ltr"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/trix"
          className="w-full rounded-2xl border border-white/12 bg-black/30 px-3 py-2.5 text-left outline-none focus:border-gold-500/60"
        />
        <p className="mt-2 text-[11px] text-ink-500">لا تكتب /index.php في النهاية — يكفي رابط المجلد.</p>

        {result && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={`mt-3 rounded-2xl px-3 py-2 text-sm ${result.ok ? 'bg-emerald-900/60 text-emerald-200' : 'bg-rose-900/60 text-rose-200'}`}
          >
            {result.text}
          </motion.div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="ghost" loading={checking} onClick={() => void check()}>
            فحص الاتصال
          </Button>
          <Button variant="gold" onClick={save}>
            حفظ ومتابعة
          </Button>
        </div>

        {!isNative() && (
          <p className="mt-3 text-center text-[11px] text-ink-500">
            أنت في المتصفح — يمكن ترك الحقل فارغاً للاتصال بنفس النطاق.
          </p>
        )}
      </Panel>
    </div>
  );
}
