/**
 * أدوات الوسائط: تحويل الصوت إلى/من base64 وجلب رسائل الدردشة الصوتية
 * ------------------------------------------------------------------
 * • يُسجَّل الصوت في المتصفح/التطبيق عبر MediaRecorder ثم يُرسل كـ base64
 * • يُعاد المقطع من الخادم كـ base64 أيضاً (يعمل مع كل الاستضافات بلا مشاكل ثنائية)
 * • تُحفظ عناوين التشغيل في ذاكرة مؤقتة حتى لا يُحمَّل المقطع مرتين
 */
import { api } from './api';

/** تحويل Blob إلى نص base64 (بدون بادئة data:) */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('تعذّر قراءة المقطع الصوتي'));
    reader.readAsDataURL(blob);
  });
}

/** تحويل نص base64 إلى Blob قابل للتشغيل */
export function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime || 'audio/webm' });
}

/** عناوين التشغيل المحفوظة: معرّف المقطع → blob URL */
const urlCache = new Map<string, string>();

/** جلب رابط تشغيل مقطع صوتي من الخادم (مع تخزين مؤقت) */
export async function voiceUrl(id: string, roomId: string): Promise<string> {
  const cached = urlCache.get(id);
  if (cached) return cached;
  const res = await api<{ audio: string; mime: string }>('voice/get', { id, room: roomId });
  const url = URL.createObjectURL(base64ToBlob(String(res.audio ?? ''), String(res.mime ?? 'audio/webm')));
  urlCache.set(id, url);
  return url;
}

/** مدة بصيغة 0:07 */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** اختيار أفضل صيغة تسجيل يدعمها الجهاز */
export function pickRecordingMime(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ];
  const MR = (window as unknown as { MediaRecorder?: { isTypeSupported?: (t: string) => boolean } }).MediaRecorder;
  if (!MR) return '';
  for (const type of candidates) {
    try {
      if (MR.isTypeSupported?.(type)) return type;
    } catch {
      /* نتجاهل */
    }
  }
  return '';
}
