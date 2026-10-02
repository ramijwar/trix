import { create } from 'zustand';
import { api, getToken, initApi, isNative, setToken, getServerUrl, setServerUrl } from './api';
import { setAudioPrefs } from './audio';

export interface User {
  id: number;
  username: string;
  name: string;
  avatar: string;
  coins: number;
  xp: number;
  level: number;
  levelInto: number;
  levelNeed: number;
  gamesPlayed: number;
  gamesWon: number;
  winRate: number;
  kaboot: number;
  streak: number;
  maxStreak: number;
  isGuest: boolean;
  isAdmin: boolean;
  cardBack: string;
  tableTheme: string;
  avatarFrame: string | null;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error' | 'gold';
}

export interface Prefs {
  sound: boolean;
  voice: boolean;
  vibration: boolean;
  cardBack: string;
  tableTheme: string;
}

const PREFS_KEY = 'trix.prefs';

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { sound: true, voice: true, vibration: true, cardBack: 'red', tableTheme: 'classic', ...JSON.parse(raw) };
  } catch {
    /* تجاهل */
  }
  return { sound: true, voice: true, vibration: true, cardBack: 'red', tableTheme: 'classic' };
}

interface AppStore {
  booted: boolean;
  user: User | null;
  token: string;
  toasts: Toast[];
  prefs: Prefs;
  needsServerSetup: boolean;
  lastPing: number | null;
  boot: () => Promise<void>;
  setUser: (u: User | null) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismiss: (id: number) => void;
  setPrefs: (p: Partial<Prefs>) => void;
  refreshUser: () => Promise<void>;
  register: (username: string, password: string, name: string, avatar: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  guest: () => Promise<void>;
  logout: () => Promise<void>;
  saveServer: (url: string) => void;
}

let toastId = 0;

export const useStore = create<AppStore>((set, get) => ({
  booted: false,
  user: null,
  token: '',
  toasts: [],
  prefs: loadPrefs(),
  needsServerSetup: false,
  lastPing: null,

  boot: async () => {
    await initApi();
    const prefs = get().prefs;
    setAudioPrefs({ sound: prefs.sound, voice: prefs.voice, vibration: prefs.vibration });
    const hasServer = Boolean(getServerUrl()) || !isNative();
    let user: User | null = null;
    if (getToken()) {
      try {
        const res = await api<{ user: User }>('me', {}, { method: 'GET', timeout: 12000 });
        user = res.user;
        set({ lastPing: Date.now() });
      } catch {
        user = null;
      }
    }
    set({ booted: true, user, token: getToken(), needsServerSetup: !hasServer });
  },

  setUser: (u) => set({ user: u }),

  toast: (text, kind = 'info') => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, text, kind }] });
    setTimeout(() => get().dismiss(id), 3200);
  },

  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p };
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    setAudioPrefs({ sound: prefs.sound, voice: prefs.voice, vibration: prefs.vibration });
    set({ prefs });
  },

  refreshUser: async () => {
    try {
      const res = await api<{ user: User }>('me', {}, { method: 'GET', timeout: 12000 });
      set({ user: res.user });
    } catch {
      /* تجاهل */
    }
  },

  register: async (username, password, name, avatar) => {
    const res = await api<{ token: string; user: User }>('auth/register', { username, password, name, avatar });
    setToken(res.token);
    set({ user: res.user, token: res.token, needsServerSetup: false });
  },

  login: async (username, password) => {
    const res = await api<{ token: string; user: User }>('auth/login', { username, password });
    setToken(res.token);
    set({ user: res.user, token: res.token, needsServerSetup: false });
  },

  guest: async () => {
    const res = await api<{ token: string; user: User }>('auth/guest', { device: navigator.userAgent.slice(0, 40) });
    setToken(res.token);
    set({ user: res.user, token: res.token, needsServerSetup: false });
  },

  logout: async () => {
    try {
      await api('auth/logout', {});
    } catch {
      /* تجاهل */
    }
    setToken('');
    set({ user: null, token: '' });
  },

  saveServer: (url) => {
    setServerUrl(url);
    set({ needsServerSetup: false });
  },
}));

export function toast(text: string, kind: Toast['kind'] = 'info'): void {
  useStore.getState().toast(text, kind);
}
