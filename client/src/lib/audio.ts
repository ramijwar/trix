/**
 * محرك الأصوات
 * - مؤثرات صوتية مُولَّدة عبر Web Audio (بدون ملفات)
 * - نداءات صوتية عربية من ملفات mp3 (المعلّق) داخل public/sounds/voice
 * يعمل داخل التطبيق وعلى المتصفح بعد أول لمسة من المستخدم.
 */

export type SfxName =
  | 'click' | 'card' | 'cardPlace' | 'shuffle' | 'trickWin' | 'turn' | 'error'
  | 'bid' | 'pass' | 'gold' | 'win' | 'lose' | 'chat' | 'flip' | 'clock';

export type VoiceName =
  | 'trump_s' | 'trump_h' | 'trump_d' | 'trump_c' | 'trump_nt'
  | 'kaboot' | 'welcome' | 'your_turn' | 'well_played' | 'good_luck';

interface AudioPrefs {
  sound: boolean;
  voice: boolean;
  vibration: boolean;
}

const prefs: AudioPrefs = { sound: true, voice: true, vibration: true };

export function setAudioPrefs(next: Partial<AudioPrefs>): void {
  Object.assign(prefs, next);
}

export function audioPrefs(): AudioPrefs {
  return { ...prefs };
}

let ctx: AudioContext | null = null;
function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** أول لمسة تُفعّل الصوت (سياسة المتصفحات) */
export function unlockAudio(): void {
  audioContext();
}

function tone(freq: number, duration: number, type: OscillatorType = 'sine', gain = 0.08, delay = 0, glideTo?: number) {
  const ac = audioContext();
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  const start = ac.currentTime + delay;
  osc.frequency.setValueAtTime(freq, start);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, glideTo), start + duration);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(g).connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

function noise(duration: number, gain = 0.05, filterFreq = 1800, delay = 0) {
  const ac = audioContext();
  if (!ac) return;
  const frames = Math.floor(ac.sampleRate * duration);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = filterFreq;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(ac.currentTime + delay);
}

/** تشغيل مؤثر صوتي */
export function sfx(name: SfxName): void {
  if (!prefs.sound) return;
  switch (name) {
    case 'click':
      tone(660, 0.06, 'triangle', 0.05);
      break;
    case 'card':
      noise(0.09, 0.055, 2400);
      break;
    case 'cardPlace':
      noise(0.07, 0.05, 900);
      tone(180, 0.08, 'sine', 0.05);
      break;
    case 'flip':
      noise(0.06, 0.04, 3200);
      break;
    case 'shuffle':
      for (let i = 0; i < 7; i++) noise(0.07, 0.035, 1600 + i * 180, i * 0.055);
      break;
    case 'trickWin':
      tone(880, 0.12, 'sine', 0.05);
      tone(1174, 0.16, 'sine', 0.045, 0.08);
      break;
    case 'turn':
      tone(1046, 0.1, 'triangle', 0.06);
      tone(1568, 0.12, 'triangle', 0.05, 0.1);
      break;
    case 'error':
      tone(220, 0.18, 'sawtooth', 0.05, 0, 140);
      break;
    case 'bid':
      tone(520, 0.08, 'square', 0.04);
      tone(780, 0.1, 'square', 0.035, 0.06);
      break;
    case 'pass':
      tone(300, 0.14, 'sine', 0.04, 0, 240);
      break;
    case 'gold':
      tone(1318, 0.1, 'triangle', 0.05);
      tone(1760, 0.14, 'triangle', 0.045, 0.08);
      tone(2093, 0.18, 'triangle', 0.04, 0.16);
      break;
    case 'win':
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.24, 'triangle', 0.06, i * 0.12));
      break;
    case 'lose':
      [440, 392, 330, 262].forEach((f, i) => tone(f, 0.26, 'sine', 0.05, i * 0.13));
      break;
    case 'chat':
      tone(920, 0.07, 'sine', 0.045);
      tone(1240, 0.09, 'sine', 0.04, 0.06);
      break;
    case 'clock':
      tone(1200, 0.05, 'square', 0.03);
      break;
  }
}

const voiceCache = new Map<string, HTMLAudioElement>();

/**
 * تشغيل نداء صوتي عربي (المعلّق) — الملفات في public/sounds/voice
 * وإذا لم تكن الملفات موجودة فلا يحدث أي خطأ.
 */
export function voice(name: VoiceName, opts: { volume?: number; rate?: number } = {}): void {
  if (!prefs.voice) return;
  try {
    const url = new URL(`sounds/voice/${name}.mp3`, document.baseURI).href;
    let el = voiceCache.get(url);
    if (!el) {
      el = new Audio(url);
      el.preload = 'auto';
      voiceCache.set(url, el);
    }
    el.volume = opts.volume ?? 0.95;
    (el as HTMLAudioElement & { playbackRate: number }).playbackRate = opts.rate ?? 1;
    el.currentTime = 0;
    void el.play().catch(() => undefined);
  } catch {
    /* تجاهل */
  }
}

/** نداء الطرنيب المناسب للون المختار */
export function voiceForTrump(suit: string): void {
  const map: Record<string, VoiceName> = { S: 'trump_s', H: 'trump_h', D: 'trump_d', C: 'trump_c', NT: 'trump_nt' };
  const name = map[suit];
  if (name) voice(name);
}
