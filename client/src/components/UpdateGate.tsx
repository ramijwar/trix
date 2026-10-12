/**
 * شاشة تحديث التطبيق (تظهر فوق كل الشاشات عند وجود نسخة جديدة)
 * ------------------------------------------------------------------
 * • مؤشر تقدّم حقيقي بالنسبة المئوية من الغلاف الأصلي (DownloadManager).
 * • التحديث الإجباري (من لوحة المدير) لا يمكن تخطّيه.
 * • بعد التنزيل تُفتح شاشة التثبيت مباشرة، وبعد التثبيت يفتح المستخدم التطبيق
 *   فيجد نسخته محدَّثة — بلا حذف النسخة القديمة أو إعادة تحميل يدوية.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './ui';
import { isNative } from '../lib/api';
import {
  canInstall,
  checkUpdate,
  downloadInBrowser,
  humanSize,
  initNativeUpdateListener,
  installDownloaded,
  installedCode,
  installedName,
  nativeState,
  openInstallSettings,
  startNativeDownload,
  type NativeUpdateEvent,
  type UpdateInfo,
} from '../lib/updates';

type Phase = 'idle' | 'found' | 'downloading' | 'ready' | 'installing' | 'error';

export function UpdateGate() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [percent, setPercent] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState('');
  const [hidden, setHidden] = useState(false);
  const [permissionNeeded, setPermissionNeeded] = useState(false);
  const started = useRef(false);

  const native = isNative();

  /** تجاهل الإشعار (في المتصفح يُحفظ للنسخة نفسها حتى لا يتكرر المزعج) */
  const dismiss = (code: number) => {
    setHidden(true);
    if (!native) {
      try {
        localStorage.setItem(`trix.update.skip.${code}`, '1');
      } catch {
        /* تجاهل */
      }
    }
  };

  useEffect(() => {
    if (native || !info) return;
    try {
      if (localStorage.getItem(`trix.update.skip.${info.versionCode}`) === '1') setHidden(true);
    } catch {
      /* تجاهل */
    }
  }, [native, info]);

  /* ---------- فحص التحديث عند فتح التطبيق + كل ٣ دقائق ---------- */
  const check = useCallback(async () => {
    const res = await checkUpdate();
    if (!res || !res.update) return;
    setInfo(res);
    setPhase((p) => (p === 'idle' ? 'found' : p));
    setHidden(false);
  }, []);

  useEffect(() => {
    void check();
    const id = setInterval(() => void check(), 180000);
    return () => clearInterval(id);
  }, [check]);

  /* ---------- استقبال أحداث الغلاف الأصلي ---------- */
  useEffect(() => {
    initNativeUpdateListener((e: NativeUpdateEvent) => {
      switch (e.kind) {
        case 'start':
          setPhase('downloading');
          setPercent(0);
          setMessage('');
          break;
        case 'progress':
          setPhase('downloading');
          setPercent(e.percent);
          setBytes(e.bytes);
          setTotal(e.total);
          break;
        case 'done':
          setPhase('ready');
          setPercent(100);
          break;
        case 'install':
          setPhase('installing');
          break;
        case 'permission':
          setPermissionNeeded(true);
          setPhase('ready');
          setMessage('اسمح للتطبيق بتثبيت التحديثات ثم اضغط «تثبيت الآن»');
          break;
        default:
          setPhase('error');
          setMessage(e.kind === 'error' ? e.message : 'فشل التحديث');
      }
    });
  }, []);

  /* ---------- استئناف الحالة بعد إعادة فتح التطبيق ---------- */
  useEffect(() => {
    const st = nativeState();
    if (!native || !st) return;
    if (st.downloadId > 0) {
      setPhase('downloading');
      void check();
    } else if (st.pending) {
      setInfo((prev) => prev ?? null);
      setPhase('ready');
      setPercent(100);
    }
  }, [native, check]);

  const begin = () => {
    if (!info) return;
    if (!native) {
      downloadInBrowser(info.url);
      return;
    }
    started.current = true;
    if (startNativeDownload(info.url)) {
      setPhase('downloading');
      setPercent(0);
    } else {
      setPhase('error');
      setMessage('تعذّر بدء التنزيل');
    }
  };

  const install = () => {
    if (native && !canInstall()) {
      setPermissionNeeded(true);
      openInstallSettings();
      return;
    }
    if (!installDownloaded()) {
      setMessage('انتظر لحظة… إن لم تُفتح شاشة التثبيت اضغط مرة أخرى');
    }
  };

  if (!info || !info.update || hidden) return null;

  const forced = Boolean(info.forced);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
      <div className="glass w-full max-w-md rounded-3xl p-5 text-center">
        <div className="mb-1 text-5xl">{forced ? '⛔' : '⬆️'}</div>
        <div className="gold-text text-xl font-black">
          {forced ? 'تحديث إجباري مطلوب' : 'يتوفّر تحديث جديد'}
        </div>
        <div className="mt-1 text-xs text-ink-300">
          نسختك الحالية: <span className="font-mono">{installedName()}</span> ({installedCode() || '—'}) • النسخة الجديدة:{' '}
          <span className="font-mono">{info.versionName || info.versionCode}</span>
          {info.size > 0 ? ` • ${humanSize(info.size)}` : ''}
        </div>

        {info.notes ? (
          <div className="mt-3 max-h-32 overflow-y-auto rounded-2xl bg-black/30 p-3 text-right text-[12px] leading-6 text-ink-200">
            {info.notes}
          </div>
        ) : null}

        {phase === 'downloading' && (
          <div className="mt-4">
            <div className="h-3 w-full overflow-hidden rounded-full bg-black/50">
              <div
                className="h-full rounded-full bg-gradient-to-l from-gold-400 to-emerald-400 transition-[width] duration-200"
                style={{ width: `${Math.max(2, percent)}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-ink-300">
              <span className="font-bold text-gold-200">{percent}%</span>
              <span>
                {total > 0 ? `${humanSize(bytes)} من ${humanSize(total)}` : 'جارٍ التنزيل…'}
              </span>
            </div>
            <div className="mt-1 text-[10px] text-ink-400">
              لا تغلق التطبيق — سيُفتح مُثبِّت التحديث تلقائياً عند انتهاء التنزيل.
            </div>
          </div>
        )}

        {phase === 'ready' && (
          <div className="mt-4 text-[12px] font-bold text-emerald-300">
            ✅ اكتمل التنزيل {message ? `— ${message}` : '— اضغط «تثبيت الآن»'}
          </div>
        )}

        {phase === 'installing' && (
          <div className="mt-4 text-[12px] font-bold text-emerald-300">
            🚀 فُتحت شاشة التثبيت — اضغط «تثبيت» ثم «فتح»
          </div>
        )}

        {phase === 'error' && (
          <div className="mt-4 text-[12px] font-bold text-rose-300">❌ {message || 'فشل التحديث، حاول مرة أخرى'}</div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          {phase !== 'downloading' && (phase === 'idle' || phase === 'found') && (
            <Button full variant="gold" onClick={begin}>
              {native ? '⬇️ تحديث الآن' : '⬇️ تنزيل نسخة الأندرويد الجديدة'}
            </Button>
          )}
          {(phase === 'ready' || phase === 'installing') && (
            <Button full variant="gold" onClick={install}>
              📲 تثبيت الآن
            </Button>
          )}
          {phase === 'downloading' && (
            <div className="text-[11px] text-ink-400">جارٍ التنزيل…</div>
          )}
          {phase === 'error' && (
            <Button full variant="gold" onClick={begin}>
              🔄 إعادة المحاولة
            </Button>
          )}
          {permissionNeeded && (
            <Button full variant="ghost" onClick={openInstallSettings}>
              ⚙️ السماح بتثبيت التطبيقات
            </Button>
          )}
          {!forced && (
            <button className="text-[11px] text-ink-400 underline" onClick={() => dismiss(info.versionCode)}>
              لاحقاً
            </button>
          )}
          {forced && (
            <div className="text-[10px] text-rose-300/80">
              هذه النسخة القديمة لم تعد مدعومة — يجب التحديث للمتابعة
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
