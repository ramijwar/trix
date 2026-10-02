import { useEffect, useRef } from 'react';
import type { RoomState } from '../game/types';
import { sfx, voice, voiceForTrump } from '../lib/audio';
import { useStore } from '../lib/store';
import { vibrate } from '../lib/utils';

/**
 * يراقب سجل الأحداث ويشغّل الأصوات والاهتزاز المناسب
 */
export function useGameSounds(state: RoomState | null, mySeat: number | null) {
  const prefs = useStore((s) => s.prefs);
  const lastEvent = useRef(0);
  const lastChat = useRef(0);
  const wasMyTurn = useRef(false);

  useEffect(() => {
    if (!state) return;
    const events = state.log ?? [];
    const fresh = events.filter((e) => e.id > lastEvent.current);
    for (const e of fresh) {
      switch (e.t) {
        case 'deal':
          sfx('shuffle');
          break;
        case 'bid':
          sfx('bid');
          break;
        case 'pass':
          sfx('pass');
          break;
        case 'double':
          sfx('gold');
          voice('kaboot');
          break;
        case 'auction_end':
          sfx('trickWin');
          break;
        case 'trump': {
          const suit = String(e.suit ?? '');
          sfx('flip');
          voiceForTrump(suit);
          break;
        }
        case 'play':
          sfx('cardPlace');
          break;
        case 'trick':
          sfx('trickWin');
          if (Number(e.team) === (mySeat ?? 0) % 2) void vibrate(22);
          break;
        case 'round_end': {
          const delta = (e.delta as number[] | undefined) ?? [0, 0];
          const myDelta = mySeat === null ? 0 : delta[(mySeat % 2)];
          if (Number(e.kaboot) === 1 || e.kaboot === true) {
            sfx('win');
            voice('kaboot');
          } else if ((myDelta ?? 0) > 0) {
            sfx('win');
          } else {
            sfx('lose');
          }
          break;
        }
        case 'game_end':
          sfx('win');
          break;
        case 'redeal':
          sfx('shuffle');
          break;
        // ===== أحداث لعبة التركس =====
        case 'contract':
          sfx('flip');
          break;
        case 'reveal':
          sfx('gold');
          break;
        case 'pile_start':
          sfx('cardPlace');
          break;
        case 'finished':
          sfx('trickWin');
          break;
        case 'deal_end': {
          const rs = (e.roundScores as number[] | undefined) ?? [];
          const mine = mySeat === null ? 0 : rs[mySeat] ?? 0;
          if (mine > 0) sfx('win');
          else if (mine < 0) sfx('lose');
          else sfx('trickWin');
          break;
        }
      }
    }
    if (fresh.length) lastEvent.current = Math.max(...fresh.map((e) => e.id));

    // رسائل الشات الجديدة
    const chats = state.chat ?? [];
    const newChats = chats.filter((c) => c.id > lastChat.current);
    if (newChats.length) {
      lastChat.current = Math.max(...newChats.map((c) => c.id));
      if (newChats.some((c) => c.seat !== mySeat)) sfx('chat');
    }

    // تنبيه دوري
    const myTurn = state.isMyTurn && (state.phase === 'bidding' || state.phase === 'playing' || state.phase === 'choosing');
    if (myTurn && !wasMyTurn.current) {
      sfx('turn');
      void vibrate(30);
      if (prefs.voice && state.phase === 'playing') voice('your_turn');
    }
    wasMyTurn.current = myTurn;
  }, [state, mySeat, prefs.voice]);
}
