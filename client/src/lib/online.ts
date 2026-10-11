/**
 * إدارة جلسة الغرفة أونلاين:
 * - استعلام طويل (Long Polling) للحصول على تحديثات فورية بأقل استهلاك
 * - ردود صغيرة عند عدم وجود جديد (توفير بيانات كبير على الشبكات الضعيفة)
 * - إعادة اتصال تلقائية مع تراجع تدريجي عشوائي (jitter) عند الانقطاع
 * - إعادة محاولة الإجراءات تلقائياً عند فشل الشبكة + زر تحديث يدوي فوري
 * - تحديثات متفائلة للواجهة (تظهر ورقتك فوراً قبل تأكيد الخادم)
 */
import { api, ApiError } from './api';
import { blobToBase64 } from './media';
import { TRIX_CONTRACT_AR, TRIX_CONTRACT_ICON } from '../game/types';
import type { RoomState, TrixContract, WireChat } from '../game/types';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

export class RoomSession {
  roomId: string;
  state: RoomState | null = null;
  status: ConnectionStatus = 'connecting';
  onState?: (s: RoomState) => void;
  onStatus?: (s: ConnectionStatus) => void;
  onError?: (message: string) => void;
  /** آخر وقت من الخادم (لتصحيح الساعات المنحرفة) */
  lastServerTime = 0;
  /** زمن آخر استجابة بالمللي ثانية (لبيان جودة الشبكة) */
  latency = 0;
  private running = false;
  private failures = 0;
  private abort: AbortController | null = null;
  /** إيقاف ناعم للاستعلام الطويل بفعل زر التحديث */
  private softAbort = false;
  /** وضع المشاهدة: يُرسل مع الاستعلام حتى يبقى المشاهد مسجّلاً بعد انقطاع طويل */
  watchMode = false;
  private onOnline?: () => void;
  private onOffline?: () => void;

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
    // استعادة الاتصال تلقائياً عند عودة الشبكة (وإظهار الانقطاع فوراً عند فقدها)
    if (typeof window !== 'undefined') {
      this.onOnline = () => void this.refresh();
      this.onOffline = () => this.setStatus('offline');
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
    }
    void this.loop();
  }

  stop(): void {
    this.running = false;
    this.softAbort = true;
    this.abort?.abort();
    if (typeof window !== 'undefined') {
      if (this.onOnline) window.removeEventListener('online', this.onOnline);
      if (this.onOffline) window.removeEventListener('offline', this.onOffline);
      this.onOnline = undefined;
      this.onOffline = undefined;
    }
  }

  /**
   * تحديث فوري (زر «تحديث» في الطاولة): يقطع الاستعلام الطويل ويجلب الحالة الآن.
   * مفيد عند انقطاع الاتصال أو تجمّد الشاشة.
   */
  async refresh(): Promise<void> {
    this.softAbort = true;
    this.abort?.abort();
    this.failures = 0;
    this.setStatus('connecting');
    try {
      const started = Date.now();
      const res = await api<{ room: RoomState }>('room/state', { room: this.roomId }, { timeout: 15000 });
      this.latency = Date.now() - started;
      // زر التحديث يُصلح حالة المشاهد أيضاً إن كان قد انقطع طويلاً
      if (res.room?.isSpectator && res.room.status !== 'waiting' && res.room.phase === 'waiting') {
        await api('room/watch', { room: this.roomId }).catch(() => undefined);
      }
      this.apply(res.room);
      this.setStatus('online');
    } catch (e) {
      this.setStatus('offline');
      throw e;
    }
  }

  private apply(room: RoomState): void {
    const prev = this.state;
    if (room.isSpectator) this.watchMode = true;
    this.state = room;
    if (!prev || prev.version !== room.version || JSON.stringify(prev) !== JSON.stringify(room)) {
      this.emit();
    }
  }

  /** الحلقة الرئيسية للاستعلام الطويل */
  private async loop(): Promise<void> {
    while (this.running) {
      try {
        this.abort = new AbortController();
        const since = this.state?.version ?? 0;
        // الشبكة الضعيفة: ننتظر أقل حتى لا نتعلّق طويلاً بلا فائدة
        const wait = this.failures > 0 ? 12 : 22;
        const started = Date.now();
        const res = await api<{ room: RoomState | null; unchanged?: boolean; version?: number; serverTime?: number }>(
          'room/poll',
          { room: this.roomId, since, wait, watch: this.watchMode },
          { timeout: wait * 1000 + 14000 },
        );
        this.latency = Date.now() - started;
        if (typeof res.serverTime === 'number' && res.serverTime > 0) this.lastServerTime = res.serverTime;
        this.failures = 0;
        this.setStatus('online');
        if (res.room) {
          this.apply(res.room);
          /*
           * لو كان المشاهد مسجّلاً ثم طال انقطاعه فأُزيل من القائمة، يعود الخادم بعرض
           * «غرفة الانتظار» بينما الطاولة تلعب — هنا نُعيد تسجيل المشاهدة فوراً.
           */
          if (res.room.isSpectator && res.room.status !== 'waiting' && res.room.phase === 'waiting') {
            void api('room/watch', { room: this.roomId }).catch(() => undefined);
          }
        }
        // رد صغير (لا جديد): لا إعادة رسم ولا بيانات — نُكمل الاستعلام فوراً
      } catch (e) {
        if (!this.running) return;
        if (this.softAbort) {
          // إيقاف مقصود من زر التحديث — نُكمل بلا عدّ فشل
          this.softAbort = false;
          await new Promise((r) => setTimeout(r, 120));
          continue;
        }
        const err = e as ApiError;
        if (err.status === 404 || err.code === 'room_not_found' || err.code === 'room_closed') {
          this.onError?.('انتهت الغرفة أو أُغلقت');
          this.stop();
          return;
        }
        this.failures++;
        if (this.failures === 1) this.onError?.(err.message);
        this.setStatus(this.failures > 2 ? 'offline' : 'connecting');
        // تراجع تدريجي مع عشوائية (jitter) لتفادي تصادم المحاولات
        const base = Math.min(8000, 600 * this.failures);
        await new Promise((r) => setTimeout(r, Math.round(base * (0.8 + Math.random() * 0.5))));
      }
    }
  }

  /** إرسال طلب مع إعادة محاولة تلقائية عند فشل الشبكة فقط */
  private async send<T>(route: string, body: Record<string, unknown>, timeout = 20000): Promise<T> {
    let last: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await api<T>(route, body, { timeout });
      } catch (e) {
        last = e;
        const err = e as ApiError;
        if (err.status !== 0 || !this.running) throw e; // خطأ منطقي أو جلسة متوقفة: لا نعيد
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1) + Math.random() * 300));
      }
    }
    throw last as Error;
  }

  /** استدعاء إجراء وإرجاع الحالة المحدّثة */
  private async act(route: string, body: Record<string, unknown> = {}, optimistic?: (s: RoomState) => void): Promise<void> {
    if (optimistic && this.state) {
      optimistic(this.state);
      this.emit();
    }
    try {
      const res = await this.send<{ room: RoomState | null }>(route, { room: this.roomId, ...body }, 20000);
      if (res.room) {
        this.apply(res.room);
      }
      this.failures = 0;
      this.setStatus('online');
    } catch (e) {
      const err = e as ApiError;
      this.onError?.(err.message);
      // إعادة تحميل الحالة لتصحيح أي تحديث متفائل
      try {
        const res = await api<{ room: RoomState }>('room/state', { room: this.roomId }, { timeout: 15000 });
        this.apply(res.room);
        this.setStatus('online');
      } catch {
        this.setStatus('offline');
      }
    }
  }

  /* ============================ الإجراءات ============================ */

  /** اختيار تسمية في التركس (صاحب المملكة) — يظهر فوراً بلا انتظار */
  chooseContract(contract: string): Promise<void> {
    return this.act('game/contract', { contract }, (s) => {
      const tx = s.trix;
      if (!tx || !tx.mustChooseContract) return;
      tx.contract = contract as TrixContract;
      tx.contractAr = TRIX_CONTRACT_AR[contract as TrixContract] ?? null;
      tx.contractIcon = TRIX_CONTRACT_ICON[contract as TrixContract] ?? null;
      tx.mustChooseContract = false;
      tx.legalContracts = [];
      tx.used = [...tx.used, contract as TrixContract];
      s.isMyTurn = false;
    });
  }

  /** كشف/تدبيل ورقة معاقِبة أو تأكيد الجاهزية لبدء اللعب */
  reveal(card?: string, done = false): Promise<void> {
    return this.act('game/reveal', { card: card ?? '', done: done || !card }, (s) => {
      const tx = s.trix;
      if (!tx) return;
      if (card) {
        tx.revealed = { ...tx.revealed, [card]: s.mySeat };
        tx.canReveal = tx.canReveal.filter((c) => c !== card);
      }
      if (done || !card) tx.revealReady = true;
    });
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

  /** إرسال رسالة صوتية قصيرة (base64) */
  async voice(blob: Blob, duration: number, mime: string): Promise<void> {
    const audio = await blobToBase64(blob);
    await this.act('room/voice', { room: this.roomId, audio, dur: Math.max(1, Math.round(duration)), mime });
  }

  /* ===== المور ===== */
  morDraw(source: 'deck' | 'pile'): Promise<void> {
    return this.act('mor/draw', { source });
  }

  morMeld(cards: string[]): Promise<void> {
    return this.act('mor/meld', { cards });
  }

  morAdd(meld: number, cards: string[]): Promise<void> {
    return this.act('mor/add', { meld, cards });
  }

  morDiscard(card: string): Promise<void> {
    return this.act('mor/discard', { card });
  }

  morTakeMor(): Promise<void> {
    return this.act('mor/take', {});
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

  /** هل أنا مشاهد (بلا مقعد)؟ */
  get isSpectator(): boolean {
    return this.state?.isSpectator === true;
  }
}

/** آخر الرسائل الجديدة (لأجل الأصوات والتنبيهات) */
export function newChatSince(state: RoomState, lastId: number): WireChat[] {
  return (state.chat ?? []).filter((m) => m.id > lastId);
}
