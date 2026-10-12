/**
 * تحديث التطبيق من داخله
 * ------------------------------------------------------------------
 * • يسأل الخادم (app/version) عن أحدث نسخة منشورة، ويقارنها برقم نسخة
 *   التطبيق المثبّت (من غلاف أندرويد: TrixNative.getVersionCode).
 * • إن وُجدت نسخة أحدث: تظهر شاشة تحديث فيها مؤشر تقدّم، وتُنزَّل داخل
 *   التطبيق ثم تُفتح شاشة التثبيت — بلا حذف النسخة القديمة.
 * • إن كانت النسخة «إجبارية» من لوحة المدير فلا يمكن تخطّي الشاشة.
 * • في نسخة الويب (بلا غلاف أندرويد) يظهر زر ينزّل الملف في المتصفح.
 */
import { api, isNative } from './api';
import { openExternal } from './native';

export interface UpdateInfo {
  update: boolean;
  forced: boolean;
  available: boolean;
  versionCode: number;
  versionName: string;
  notes: string;
  size: number;
  url: string;
  minCode: number;
  clientCode: number;
  serverTime: number;
}

interface Bridge {
  getVersionCode?: () => number;
  getVersionName?: () => string;
  canInstall?: () => boolean;
  downloadAndInstall?: (url: string) => void;
  installUpdate?: () => boolean;
  openInstallSettings?: () => void;
  getUpdateState?: () => string;
  cancelUpdate?: () => void;
}

const bridge = (): Bridge | null => (window as unknown as { TrixNative?: Bridge }).TrixNative ?? null;

/** رقم نسخة التطبيق المثبّتة (0 في نسخة الويب) */
export function installedCode(): number {
  const b = bridge();
  if (b?.getVersionCode) {
    try {
      return Number(b.getVersionCode()) || 0;
    } catch {
      /* تجاهل */
    }
  }
  return 0;
}

export function installedName(): string {
  const b = bridge();
  if (b?.getVersionName) {
    try {
      return String(b.getVersionName());
    } catch {
      /* تجاهل */
    }
  }
  return 'web';
}

/** هل يمكن للتطبيق تثبيت تحديث (إذن «تثبيت تطبيقات غير معروفة»)؟ */
export function canInstall(): boolean {
  const b = bridge();
  if (!b?.canInstall) return false;
  try {
    return Boolean(b.canInstall());
  } catch {
    return false;
  }
}

/** رابط تنزيل كامل (يُبنى من رابط الخادم الحالي) */
export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = (localStorage.getItem('trix.server') || '').replace(/\/+$/, '');
  return base ? `${base}/${pathOrUrl.replace(/^\/+/, '')}` : pathOrUrl;
}

/** فحص وجود تحديث */
export async function checkUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await api<UpdateInfo>(
      'app/version',
      { version_code: installedCode(), platform: isNative() ? 'android' : 'web', version_name: installedName() },
      { method: 'GET', timeout: 12000 }
    );
    return res;
  } catch {
    return null; // لا نُزعج اللاعب إن فشل الفحص (شبكة ضعيفة مثلاً)
  }
}

/** بدء تنزيل التحديث عبر الغلاف الأصلي (يُبلّغ التقدّم عبر window.__trixUpdate) */
export function startNativeDownload(url: string): boolean {
  const b = bridge();
  if (!b?.downloadAndInstall) return false;
  try {
    b.downloadAndInstall(absoluteUrl(url));
    return true;
  } catch {
    return false;
  }
}

/** تثبيت الملف المُنزَّل (بعد منح الإذن مثلاً) */
export function installDownloaded(): boolean {
  const b = bridge();
  try {
    return Boolean(b?.installUpdate?.());
  } catch {
    return false;
  }
}

export function openInstallSettings(): void {
  try {
    bridge()?.openInstallSettings?.();
  } catch {
    /* تجاهل */
  }
}

export function cancelNativeUpdate(): void {
  try {
    bridge()?.cancelUpdate?.();
  } catch {
    /* تجاهل */
  }
}

/** حالة التنزيل المحفوظة في الغلاف (للاستئناف بعد إعادة تشغيل التطبيق) */
export function nativeState(): { downloadId: number; pending: string } | null {
  const b = bridge();
  if (!b?.getUpdateState) return null;
  try {
    return JSON.parse(b.getUpdateState()) as { downloadId: number; pending: string };
  } catch {
    return null;
  }
}

/** في المتصفح: تنزيل الملف مباشرة */
export function downloadInBrowser(url: string): void {
  openExternal(absoluteUrl(url));
}

/** تنسيق الحجم بالعربية */
export function humanSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / 1048576;
  if (mb >= 1) return `${mb.toFixed(1)} ميجابايت`;
  return `${Math.max(1, Math.round(bytes / 1024))} كيلوبايت`;
}

/** نوع أحداث الغلاف الأصلي أثناء التنزيل */
export type NativeUpdateEvent =
  | { kind: 'start'; id?: number }
  | { kind: 'progress'; percent: number; bytes: number; total: number; status: number }
  | { kind: 'done'; path: string }
  | { kind: 'install'; name: string }
  | { kind: 'permission' }
  | { kind: 'error'; message: string; reason?: number };

/** مُهيّأ لاستقبال أحداث الغلاف: window.__trixUpdate(event, jsonString) */
export function initNativeUpdateListener(handler: (e: NativeUpdateEvent) => void): void {
  const w = window as unknown as { __trixUpdate?: (event: string, json: string) => void };
  w.__trixUpdate = (event: string, json: string) => {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(json || '{}') as Record<string, unknown>;
    } catch {
      data = {};
    }
    switch (event) {
      case 'start':
        handler({ kind: 'start', id: Number(data.id) || undefined });
        break;
      case 'progress':
        handler({
          kind: 'progress',
          percent: Number(data.percent) || 0,
          bytes: Number(data.bytes) || 0,
          total: Number(data.total) || 0,
          status: Number(data.status) || 0,
        });
        break;
      case 'done':
        handler({ kind: 'done', path: String(data.path || '') });
        break;
      case 'install':
        handler({ kind: 'install', name: String(data.name || '') });
        break;
      case 'permission':
        handler({ kind: 'permission' });
        break;
      default:
        handler({ kind: 'error', message: String(data.message || 'فشل التحديث'), reason: Number(data.reason) || undefined });
    }
  };
}
