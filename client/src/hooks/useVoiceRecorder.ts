/**
 * مُسجّل رسائل صوتية قصيرة للدردشة
 * ------------------------------------------------------------------
 * start() يطلب الميكروفون ويبدأ التسجيل، stop() يوقف ويعيد المقطع،
 * cancel() يلغي بلا إرسال. يتوقف التسجيل تلقائياً عند الحد الأقصى.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { pickRecordingMime } from '../lib/media';

export interface RecordedVoice {
  blob: Blob;
  duration: number;
  mime: string;
}

export function useVoiceRecorder(maxSeconds = 30) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const resolveRef = useRef<((v: RecordedVoice | null) => void) | null>(null);
  const cancelledRef = useRef(false);

  const cleanup = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setSeconds(0);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async (): Promise<boolean> => {
    setError('');
    const media = navigator.mediaDevices as MediaDevices | undefined;
    const MR = (window as unknown as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
    if (!media?.getUserMedia || !MR) {
      setError('التسجيل الصوتي غير مدعوم على هذا الجهاز');
      return false;
    }
    try {
      const stream = await media.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickRecordingMime();
      const rec = mime ? new MR(stream, { mimeType: mime, audioBitsPerSecond: 32000 }) : new MR(stream);
      recorderRef.current = rec;
      chunksRef.current = [];
      cancelledRef.current = false;
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const duration = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        const type = rec.mimeType || mime || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        const resolve = resolveRef.current;
        resolveRef.current = null;
        const cancelled = cancelledRef.current;
        cleanup();
        resolve?.(!cancelled && blob.size > 0 ? { blob, duration: Math.min(duration, maxSeconds), mime: type } : null);
      };
      startedAtRef.current = Date.now();
      rec.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setSeconds(elapsed);
        if (elapsed > maxSeconds + 5) {
          // حماية: لو بقي التسجيل مفتوحاً طويلاً بلا إيقاف (الشاشة في الخلفية مثلاً)
          const r = recorderRef.current;
          if (r && r.state !== 'inactive') {
            cancelledRef.current = true;
            r.stop();
          }
        }
      }, 250);
      return true;
    } catch (e) {
      const name = (e as { name?: string })?.name ?? '';
      setError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'الميكروفون غير مسموح — فعّل الإذن من إعدادات الجهاز/المتصفح'
          : 'تعذّر الوصول إلى الميكروفون',
      );
      cleanup();
      return false;
    }
  }, [cleanup, maxSeconds]);

  /** إيقاف التسجيل وإرجاع المقطع (أو null إن أُلغي/فشل) */
  const stop = useCallback((): Promise<RecordedVoice | null> => {
    return new Promise((resolve) => {
      const rec = recorderRef.current;
      if (!rec || rec.state === 'inactive') {
        cleanup();
        resolve(null);
        return;
      }
      resolveRef.current = resolve;
      cancelledRef.current = false;
      rec.stop();
    });
  }, [cleanup]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    const rec = recorderRef.current;
    resolveRef.current = null;
    if (rec && rec.state !== 'inactive') rec.stop();
    cleanup();
  }, [cleanup]);

  return { recording, seconds, error, start, stop, cancel, maxSeconds, setError };
}
