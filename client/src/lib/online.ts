/**
 * إدارة جلسة الغرفة أونلاين:
 * - استعلام طويل (Long Polling) للحصول على تحديثات فورية بأقل استهلاك
 * - إعادة اتصال تلقائية مع تراجع تدريجي عند انقطاع الشبكة
 * - تحديثات متفائلة للواجهة (تظهر ورقتك فوراً قبل تأكيد الخادم)
 */
import { api, ApiError } from './api';
import type { RoomState, WireChat } from '../game/types';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

export class RoomSession {
  roomId: string;
  state: RoomState | null = null;
  status: ConnectionStatus = 'connecting';
  onState?: (s: RoomState) => void;
  onStatus?: (s: ConnectionStatus) => void;
  onError?: (message: string) => void;
  private running = false;
  private failures = 0;
  private abort: AbortController | null = null;

  constructor(roomId: string, initial?: RoomState) {
    this.roomId = roomId;
    if (initial) this.state = initial;
  }

  private emit(): void {
    if (this.state) this.onState?.(this.state);
  }

  private setStatus(s: ConnectionStatus): void {
    if (this.status !== s) {
      this.status = s;
      this.onStatus?.(s);
    }
  }

  /** بدء حلقة الاستعلام الطويل */
  connect(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
    this.abort?.abort();
  }

  private apply(room: RoomState): void {
    const prev = this.state;
    this.state = room;
    if (!prev || prev.version !== room.version || JSON.stringify(prev) !== JSON.stringify(room)) {
      this.emit();
    }
  }

  /** الحلقة الرئيسية للاستعلام الطويل */
  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const since = this.state?.version ?? 0;
        const res = await api<{ room: RoomState }>(
          'room/poll',
          { room: this.roomId, since, wait: 20 },
          { timeout: 34000 },
        );
        this.failures = 0;
        this.setStatus('online');
        this.apply(res.room);
      } catch (e) {
        if (!this.running) return;
        const err = e as ApiError;
        if (err.status === 404 || err.code === 'room_not_found') {
          this.onError?.('انتهت الغرفة أو أُغلقت');
          this.stop();
          return;
        }
        this.failures++;
        if (this.failures === 1) this.onError?.(err.message);
        this.setStatus(this.failures > 2 ? 'offline' : 'connecting');
        const wait = Math.min(6000, 700 * this.failures);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  /** استدعاء إجراء وإرجاع الحالة المحدّثة */
  private async act(route: string, body: Record<string, unknown> = {}, optimistic?: (s: RoomState) => void): Promise<void> {
    if (optimistic && this.state) {
      optimistic(this.state);
      this.emit();
    }
    try {
      const res = await api<{ room: RoomState }>(route, { room: this.roomId, ...body }, { timeout: 20000 });
      this.apply(res.room);
    } catch (e) {
      const err = e as ApiError;
      this.onError?.(err.message);
      // إعادة تحميل الحالة لتصحيح أي تحديث متفائل
      try {
        const res = await api<{ room: RoomState }>('room/state', { room: this.roomId }, { timeout: 15000 });
        this.apply(res.room);
      } catch {
        /* تجاهل */
      }
    }
  }

  /* ============================ الإجراءات ============================ */

  /** اختيار تسمية في التركس (صاحب المملكة) */
  chooseContract(contract: string): Promise<void> {
    return this.act('game/contract', { contract });
  }

  /** كشف/تدبيل ورقة معاقِبة أو تأكيد الجاهزية لبدء اللعب */
  reveal(card?: string, done = false): Promise<void> {
    return this.act('game/reveal', { card: card ?? '', done: done || !card });
  }


  bid(action: 'bid' | 'pass' | 'double', value?: number): Promise<void> {
    return this.act('game/bid', { action, value }, (s) => {
      if (action === 'bid' && value) {
        s.bid.value = value;
        s.bid.seat = s.mySeat;
        s.isMyTurn = false;
        s.legalBids = [];
      } else if (action === 'pass') {
        s.bid.passed = [...s.bid.passed, s.mySeat];
        s.isMyTurn = false;
        s.legalBids = [];
      } else if (action === 'double') {
        s.bid.doubled = true;
        s.bid.doubledBy = s.mySeat;
        s.isMyTurn = false;
      }
    });
  }

  trump(suit: string): Promise<void> {
    return this.act('game/trump', { suit }, (s) => {
      s.trump = suit as RoomState['trump'];
      s.phase = 'playing';
      s.mustChooseTrump = false;
      s.isMyTurn = false;
    });
  }

  play(card: string): Promise<void> {
    return this.act('game/play', { card }, (s) => {
      s.myHand = s.myHand.filter((c) => c !== card);
      s.trick = [...s.trick, { seat: s.mySeat, card }];
      s.isMyTurn = false;
      s.legalCards = [];
    });
  }

  chat(text: string, emoji?: string): Promise<void> {
    return this.act('room/chat', { text, emoji });
  }

  ready(ready: boolean): Promise<void> {
    return this.act('room/ready', { ready });
  }

  startMatch(): Promise<void> {
    return this.act('room/start', {});
  }

  continueRound(): Promise<void> {
    return this.act('room/continue', {});
  }

  seat(seat: number): Promise<void> {
    return this.act('room/seat', { seat });
  }

  swap(seat: number): Promise<void> {
    return this.act('room/swap', { seat });
  }

  swapRespond(accept: boolean): Promise<void> {
    return this.act('room/swap/respond', { accept });
  }

  botAdd(seat?: number): Promise<void> {
    return this.act('room/bot/add', seat === undefined ? {} : { seat });
  }

  botRemove(seat: number): Promise<void> {
    return this.act('room/bot/remove', { seat });
  }

  updateSettings(settings: Record<string, unknown>): Promise<void> {
    return this.act('room/settings', { settings });
  }

  kick(seat: number): Promise<void> {
    return this.act('room/kick', { seat });
  }

  leave(): Promise<void> {
    this.stop();
    return api('room/leave', { room: this.roomId }).then(() => undefined).catch(() => undefined);
  }
}

/** آخر الرسائل الجديدة (لأجل الأصوات والتنبيهات) */
export function newChatSince(state: RoomState, lastId: number): WireChat[] {
  return (state.chat ?? []).filter((m) => m.id > lastId);
}
