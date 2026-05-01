import type {
  ClientMessage,
  ErrorMessage,
  SegmentEndMessage,
  SegmentStartMessage,
  ServerMessage,
} from './types';

type Listeners = {
  open: Array<() => void>;
  close: Array<(code: number, reason: string) => void>;
  error: Array<(message: string) => void>;
  segmentStart: Array<(m: SegmentStartMessage) => void>;
  segmentEnd: Array<(m: SegmentEndMessage) => void>;
  audio: Array<(pcm: ArrayBuffer) => void>;
  serverError: Array<(m: ErrorMessage) => void>;
};

type EventName = keyof Listeners;

export class KokoroClient {
  private ws: WebSocket | null = null;
  private listeners: Listeners = {
    open: [],
    close: [],
    error: [],
    segmentStart: [],
    segmentEnd: [],
    audio: [],
    serverError: [],
  };

  connect(baseUrl: string, apiKey: string): void {
    if (this.ws) this.close();
    const sep = baseUrl.includes('?') ? '&' : '?';
    const url = `${baseUrl}${sep}api_key=${encodeURIComponent(apiKey)}`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => this.emit('open');
    ws.onclose = (e) => this.emit('close', e.code, e.reason);
    ws.onerror = (e: any) => this.emit('error', e?.message ?? 'websocket error');
    ws.onmessage = (e) => this.handleMessage(e.data);
    this.ws = ws;
  }

  sendConfig(voice?: string, speed?: number): void {
    this.send({ type: 'config', voice, speed });
  }

  sendText(delta: string): void {
    if (!delta) return;
    this.send({ type: 'text', delta });
  }

  sendFlush(): void {
    this.send({ type: 'flush' });
  }

  sendCancel(): void {
    this.send({ type: 'cancel' });
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
  }

  on<E extends EventName>(event: E, cb: Listeners[E][number]): () => void {
    (this.listeners[event] as Array<typeof cb>).push(cb);
    return () => this.off(event, cb);
  }

  off<E extends EventName>(event: E, cb: Listeners[E][number]): void {
    const arr = this.listeners[event] as Array<typeof cb>;
    const i = arr.indexOf(cb);
    if (i >= 0) arr.splice(i, 1);
  }

  private send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  private handleMessage(data: any): void {
    if (typeof data === 'string') {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(data) as ServerMessage;
      } catch {
        this.emit('error', 'invalid server json');
        return;
      }
      switch (msg.type) {
        case 'segment_start':
          this.emit('segmentStart', msg);
          break;
        case 'segment_end':
          this.emit('segmentEnd', msg);
          break;
        case 'error':
          this.emit('serverError', msg);
          break;
      }
    } else if (data instanceof ArrayBuffer) {
      this.emit('audio', data);
    } else if (data && typeof (data as Blob).arrayBuffer === 'function') {
      (data as Blob).arrayBuffer().then((buf) => this.emit('audio', buf));
    }
  }

  private emit<E extends EventName>(event: E, ...args: Parameters<Listeners[E][number]>): void {
    for (const cb of this.listeners[event]) {
      try {
        (cb as (...a: any[]) => void)(...args);
      } catch {
        // listener errors are not the client's problem
      }
    }
  }
}
