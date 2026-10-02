import { useEffect, useMemo, useRef, useState } from 'react';
import { useNav } from '../lib/nav';
import { useStore } from '../lib/store';
import { RoomSession } from '../lib/online';
import type { RoomState } from '../game/types';
import { Spinner } from '../components/ui';
import { GameView, WaitingRoom, type RoomActions } from '../components/GameView';
import { OfflineRoom } from './OfflineRoom';

export function RoomScreen() {
  const roomId = useNav((s) => s.roomId);
  if (!roomId || roomId === 'offline') return <OfflineRoom />;
  return <OnlineRoom roomId={roomId} />;
}

function OnlineRoom({ roomId }: { roomId: string }) {
  const toast = useStore((s) => s.toast);
  const refreshUser = useStore((s) => s.refreshUser);
  const leaveRoom = useNav((s) => s.leaveRoom);
  const [state, setState] = useState<RoomState | null>(null);
  const [status, setStatus] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const sessionRef = useRef<RoomSession | null>(null);

  useEffect(() => {
    const session = new RoomSession(roomId);
    sessionRef.current = session;
    session.onState = (s) => setState(s);
    session.onStatus = (s) => setStatus(s);
    session.onError = (m) => toast(m, 'error');
    session.connect();
    return () => {
      session.stop();
      sessionRef.current = null;
    };
  }, [roomId, toast]);

  const actions: RoomActions = useMemo(
    () => ({
      bid: (action, value) => void sessionRef.current?.bid(action, value),
      trump: (suit) => void sessionRef.current?.trump(suit),
      play: (code) => void sessionRef.current?.play(code),
      chat: (text, emoji) => void sessionRef.current?.chat(text, emoji),
      continueRound: () => void sessionRef.current?.continueRound(),
      ready: (r) => void sessionRef.current?.ready(r),
      start: () => void sessionRef.current?.startMatch(),
      addBot: (seat) => void sessionRef.current?.botAdd(seat),
      removeBot: (seat) => void sessionRef.current?.botRemove(seat),
      sit: (seat) => void sessionRef.current?.seat(seat),
      swap: (seat) => void sessionRef.current?.swap(seat),
      respondSwap: (accept) => void sessionRef.current?.swapRespond(accept),
      saveSettings: (s) => void sessionRef.current?.updateSettings(s),
      kick: (seat) => void sessionRef.current?.kick(seat),
      leave: () => {
        void sessionRef.current?.leave();
        leaveRoom();
        void refreshUser();
      },
    }),
    [leaveRoom, refreshUser],
  );

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="جارٍ الدخول إلى الطاولة…" />
      </div>
    );
  }

  const inGame = state.phase !== 'waiting';
  return inGame ? (
    <GameView state={state} actions={actions} status={status} onExit={actions.leave} />
  ) : (
    <WaitingRoom state={state} actions={actions} onExit={actions.leave} />
  );
}
