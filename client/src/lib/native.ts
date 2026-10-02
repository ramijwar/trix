/**
 * طبقة الوظائف الأصلية
 * تعمل مع:
 *  - غلاف الأندرويد المدمج (window.TrixNative) — نسخة APK الجاهزة
 *  - Capacitor (إن أُضيفت المنصة) — نفس الواجهة
 *  - المتصفح — بدائل JS عادية
 */

interface TrixNativeBridge {
  vibrate: (ms: number) => void;
  setItem?: (key: string, value: string) => void;
  getItem?: (key: string) => string;
  removeItem?: (key: string) => void;
  toast: (text: string) => void;
  setKeepScreenOn: (on: boolean) => void;
  copyToClipboard: (text: string) => void;
  openExternal: (url: string) => void;
  exitApp: () => void;
  getInfo: () => string;
}

function bridge(): TrixNativeBridge | null {
  const b = (window as unknown as { TrixNative?: TrixNativeBridge }).TrixNative;
  return b ?? null;
}

export function isShellApp(): boolean {
  return bridge() !== null;
}

export function shellInfo(): { platform: string; version: string; sdk?: number } | null {
  const b = bridge();
  if (!b) return null;
  try {
    return JSON.parse(b.getInfo()) as { platform: string; version: string; sdk?: number };
  } catch {
    return null;
  }
}

export async function vibrateDevice(ms = 20): Promise<void> {
  const b = bridge();
  if (b) {
    try {
      b.vibrate(ms);
      return;
    } catch {
      /* متابعة */
    }
  }
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ms > 25 ? ImpactStyle.Medium : ImpactStyle.Light });
    return;
  } catch {
    /* متابعة */
  }
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* لا شيء */
  }
}

export function nativeToast(text: string): void {
  try {
    bridge()?.toast(text);
  } catch {
    /* لا شيء */
  }
}

export function keepScreenOn(on: boolean): void {
  try {
    bridge()?.setKeepScreenOn(on);
  } catch {
    /* لا شيء */
  }
}

export async function copyText(text: string): Promise<boolean> {
  const b = bridge();
  if (b) {
    try {
      b.copyToClipboard(text);
      return true;
    } catch {
      /* متابعة */
    }
  }
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* متابعة */
  }
  return false;
}

export function openExternal(url: string): void {
  const b = bridge();
  if (b) {
    try {
      b.openExternal(url);
      return;
    } catch {
      /* متابعة */
    }
  }
  try {
    window.open(url, '_blank');
  } catch {
    /* لا شيء */
  }
}

export function exitApp(): void {
  try {
    bridge()?.exitApp();
  } catch {
    /* لا شيء */
  }
}


/* ============================ تخزين دائم ============================ */

/** هل يوجد تخزين أصلي (غلاف أندرويد)؟ */
export function hasNativeStore(): boolean {
  const b = bridge();
  return Boolean(b && typeof b.setItem === 'function' && typeof b.getItem === 'function');
}

export function nativeStoreSet(key: string, value: string): boolean {
  const b = bridge();
  if (!b || typeof b.setItem !== 'function') return false;
  try {
    b.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function nativeStoreGet(key: string): string | null {
  const b = bridge();
  if (!b || typeof b.getItem !== 'function') return null;
  try {
    const v = b.getItem(key);
    return v === '' ? null : v;
  } catch {
    return null;
  }
}

export function nativeStoreRemove(key: string): void {
  const b = bridge();
  if (!b || typeof b.removeItem !== 'function') return;
  try {
    b.removeItem(key);
  } catch {
    /* لا شيء */
  }
}
