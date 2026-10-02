/**
 * طبقة الاتصال بالخادم (PHP API)
 * - في المتصفح: تعمل افتراضياً على نفس النطاق (بدون إعدادات)
 * - في تطبيق الأندرويد: يتم حفظ عنوان الخادم مرة واحدة من شاشة الاتصال
 */
import { Preferences } from '@capacitor/preferences';
import { BUILT_IN_SERVER } from '../config';
import { isShellApp, nativeStoreGet, nativeStoreRemove, nativeStoreSet } from './native';

const SERVER_KEY = 'trix.server';
const TOKEN_KEY = 'trix.token';

export function isNative(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.() || isShellApp());
}

/** تخزين آمن: يعمل مع Capacitor وعند غياب الإضافة يستخدم التخزين المحلي */
const prefs = {
  async get(key: string): Promise<string> {
    const native = nativeStoreGet(key); // غلاف أندرويد
    if (native !== null) return native;
    try {
      const r = await Preferences.get({ key });
      if (r.value) return r.value;
    } catch {
      /* غلاف بدون Capacitor */
    }
    return localStorage.getItem(key) ?? '';
  },
  async set(key: string, value: string): Promise<void> {
    nativeStoreSet(key, value);
    try {
      localStorage.setItem(key, value);
    } catch {
      /* قد تكون الذاكرة المحلية معطّلة */
    }
    try {
      await Preferences.set({ key, value });
    } catch {
      /* تجاهل */
    }
  },
  async remove(key: string): Promise<void> {
    nativeStoreRemove(key);
    try {
      localStorage.removeItem(key);
    } catch {
      /* تجاهل */
    }
    try {
      await Preferences.remove({ key });
    } catch {
      /* تجاهل */
    }
  },
};

let serverUrl = '';
let token = '';

export function getServerUrl(): string {
  return serverUrl || localStorage.getItem(SERVER_KEY) || BUILT_IN_SERVER || '';
}

export function setServerUrl(url: string): void {
  serverUrl = url.trim().replace(/\/+$/, '');
  localStorage.setItem(SERVER_KEY, serverUrl);
  void prefs.set(SERVER_KEY, serverUrl);
}

export function getToken(): string {
  return token || localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(value: string): void {
  token = value;
  if (value) {
    localStorage.setItem(TOKEN_KEY, value);
    void prefs.set(TOKEN_KEY, value);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    void prefs.remove(TOKEN_KEY);
  }
}

/** تحميل الإعدادات المحفوظة عند بدء التطبيق */
export async function initApi(): Promise<void> {
  try {
    const s = await prefs.get(SERVER_KEY);
    if (s) {
      serverUrl = s;
      localStorage.setItem(SERVER_KEY, s);
    }
    const t = await prefs.get(TOKEN_KEY);
    if (t) {
      token = t;
      localStorage.setItem(TOKEN_KEY, t);
    }
  } catch {
    /* المتصفح: نكتفي بالتخزين المحلي */
  }
  if (!serverUrl) serverUrl = localStorage.getItem(SERVER_KEY) || BUILT_IN_SERVER || '';
  if (!token) token = localStorage.getItem(TOKEN_KEY) || '';
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code = 'error', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface ApiResult {
  ok: boolean;
  [key: string]: unknown;
}

/** بناء رابط الـ API */
export function apiUrl(route: string): string {
  const base = getServerUrl();
  const query = `index.php?r=${encodeURIComponent(route)}`;
  if (base) return `${base}/${query}`;
  // بدون عنوان مخزَّن: نستخدم نفس مجلد الصفحة (يعمل سواء على النطاق الجذري أو داخل مجلد فرعي)
  try {
    return new URL(query, document.baseURI).href;
  } catch {
    return `/${query}`;
  }
}

export { BUILT_IN_SERVER };

export async function api<T = ApiResult>(
  route: string,
  body: Record<string, unknown> = {},
  opts: { method?: 'GET' | 'POST'; timeout?: number; retries?: number } = {},
): Promise<T> {
  const method = opts.method ?? 'POST';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout ?? 30000);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const tok = getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  // بعض الاستضافات المشتركة تحذف ترويسة Authorization — نرسل التوكِن أيضاً
  // في جسم الطلب (POST) أو في الرابط (GET) كقناة احتياطية.
  let url = apiUrl(route);
  let payload: string | undefined;
  if (method === 'GET') {
    if (tok) url += `&t=${encodeURIComponent(tok)}`;
  } else {
    payload = JSON.stringify(tok && body.token === undefined ? { ...body, token: tok } : body);
  }
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: payload,
      signal: controller.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    let data: ApiResult;
    try {
      data = JSON.parse(text) as ApiResult;
    } catch {
      throw new ApiError('رد غير متوقع من الخادم', 'bad_response', res.status);
    }
    if (!data.ok) {
      const err = new ApiError(String(data.error ?? 'خطأ غير معروف'), String(data.code ?? 'error'), res.status);
      if (res.status === 401) setToken('');
      throw err;
    }
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    const aborted = (e as { name?: string })?.name === 'AbortError';
    throw new ApiError(
      aborted ? 'انتهت مهلة الاتصال بالخادم' : 'تعذّر الاتصال بالخادم — تأكد من الشبكة وعنوان الخادم',
      aborted ? 'timeout' : 'network',
      0,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** فحص صحة الخادم (يُستخدم في شاشة الإعداد) */
export async function pingServer(url: string): Promise<{ ok: boolean; version?: string; app?: string; error?: string }> {
  const clean = url.trim().replace(/\/+$/, '');
  let target: string;
  if (clean) {
    target = `${clean}/index.php?r=health`;
  } else {
    try {
      target = new URL('index.php?r=health', document.baseURI).href;
    } catch {
      target = '/index.php?r=health';
    }
  }
  try {
    const res = await fetch(target, { cache: 'no-store' });
    const data = (await res.json()) as { ok?: boolean; version?: string; app?: string; error?: string };
    return { ok: Boolean(data.ok), version: data.version, app: data.app, error: data.error };
  } catch {
    return { ok: false, error: 'تعذّر الوصول إلى الخادم' };
  }
}
