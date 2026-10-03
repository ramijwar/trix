import { useEffect, useMemo, useRef, useState } from 'react';
import { useNav } from '../lib/nav';
import { useStore } from '../lib/store';
import { OfflineMatch } from '../game/offline';
import type { RoomState, Suit } from '../game/types';
import { Spinner } from '../components/ui';
import { GameView, type RoomActions } from '../components/GameView';

/**
 * تدريب محلي ضد 3 بوتات — بنفس قوانين اللعبة، بدون إنترنت
 */
export function OfflineRoom() {
  const user = useStore((s) => s.user);
  const leaveRoom = useNav((s) => s.leaveRoom);
  const [state, setState] = useState<RoomState | null>(null);
  const matchRef = useRef<OfflineMatch | null>(null);
  const trickFullAt = useRef(0);

  if (!matchRef.current) {
    matchRef.current = new OfflineMatch({
      playerName: user?.name ?? 'لاعب',
      avatar: user?.avatar ?? '🦊',
      playerLevel: user?.level ?? 1,
    });
  }

  useEffect(() => {
    const m = matchRef.current!;
    setState(m.snapshot());
    const id = setInterval(() => {
      const live = matchRef.current!;
      const canAct = live.phase === 'bidding' || live.phase === 'playing';
      if (canAct) {
        if (live.trick.length === 4) {
          if (trickFullAt.current === 0) trickFullAt.current = Date.now();
          if (Date.now() - trickFullAt.current > 950) {
            live.resolveTrick();
            trickFullAt.current = 0;
          }
        } else {
          trickFullAt.current = 0;
          const seat = live.seats[live.turn];
          if (seat?.isBot) live.botStep();
        }
      }
      setState(live.snapshot());
    }, 520);
    return () => clearInterval(id);
  }, []);

  const actions: RoomActions = useMemo(
    () => ({
      bid: (action, value) => {
        const m = matchRef.current!;
        const seat = m.mySeat;
        if (action === 'bid' && value) m.bid(seat, value);
        else if (action === 'pass') m.pass(seat);
        else if (action === 'double') m.double(seat);
        setState(m.snapshot());
      },
      trump: (suit) => {
        const m = matchRef.current!;
        m.chooseTrump(m.mySeat, suit as Suit | 'NT');
        setState(m.snapshot());
      },
      play: (code) => {
        const m = matchRef.current!;
        m.play(m.mySeat, code);
        setState(m.snapshot());
      },
      chat: (text) => {
        const m = matchRef.current!;
        m.pushChat(m.mySeat, text);
        setState(m.snapshot());
      },
      continueRound: () => {
        const m = matchRef.current!;
        if (m.phase === 'round_end') {
          m.nextRound();
        } else if (m.phase === 'game_end') {
          // مباراة جديدة من الصفر بنفس اللاعبين
          matchRef.current = new OfflineMatch({
            playerName: m.seats[m.mySeat].name,
            avatar: m.seats[m.mySeat].avatar,
            playerLevel: m.seats[m.mySeat].level,
            target: m.target,
            settings: m.settings,
          });
          trickFullAt.current = 0;
        }
        setState(matchRef.current!.snapshot());
      },
      leave: () => leaveRoom(),
    }),
    [leaveRoom],
  );

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="جارٍ تجهيز الطاولة…" />
      </div>
    );
  }

  return <GameView state={state} actions={actions} status="online" onExit={actions.leave} />;
}
