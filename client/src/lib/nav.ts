import { create } from 'zustand';

export type View = 'lobby' | 'room' | 'leaderboard' | 'profile' | 'shop' | 'settings' | 'admin' | 'tournament';

interface NavStore {
  view: View;
  roomId: string;
  roomInitialCode: string;
  /** البطولة المفتوحة في شاشة الانتظار */
  tournamentId: number;
  go: (v: View) => void;
  enterRoom: (roomId: string, code?: string) => void;
  leaveRoom: () => void;
  openTournament: (id: number) => void;
}

export const useNav = create<NavStore>((set) => ({
  view: 'lobby',
  roomId: '',
  roomInitialCode: '',
  tournamentId: 0,
  go: (v) => set({ view: v }),
  enterRoom: (roomId, code = '') => set({ view: 'room', roomId, roomInitialCode: code }),
  leaveRoom: () => set({ view: 'lobby', roomId: '', roomInitialCode: '' }),
  openTournament: (id) => set({ view: 'tournament', tournamentId: id }),
}));
