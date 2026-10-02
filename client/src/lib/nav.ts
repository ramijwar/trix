import { create } from 'zustand';

export type View = 'lobby' | 'room' | 'leaderboard' | 'profile' | 'shop' | 'settings';

interface NavStore {
  view: View;
  roomId: string;
  roomInitialCode: string;
  go: (v: View) => void;
  enterRoom: (roomId: string, code?: string) => void;
  leaveRoom: () => void;
}

export const useNav = create<NavStore>((set) => ({
  view: 'lobby',
  roomId: '',
  roomInitialCode: '',
  go: (v) => set({ view: v }),
  enterRoom: (roomId, code = '') => set({ view: 'room', roomId, roomInitialCode: code }),
  leaveRoom: () => set({ view: 'lobby', roomId: '', roomInitialCode: '' }),
}));
