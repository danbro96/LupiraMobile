import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { pcmToWav } from './pcm-to-wav';

type QueuedItem = { id: number; file: File };

export class PlaybackQueue {
  private queue: QueuedItem[] = [];
  private currentPlayer: AudioPlayer | null = null;
  private currentFile: File | null = null;
  private idCounter = 0;
  private active = true;
  private listeners = { drained: [] as Array<() => void> };

  enqueue(pcm: ArrayBuffer): void {
    if (!this.active) return;
    const id = ++this.idCounter;
    const wav = pcmToWav(pcm);
    const file = new File(Paths.cache, `lupira-segment-${id}-${Date.now()}.wav`);
    try {
      file.create({ overwrite: true });
      file.write(new Uint8Array(wav));
    } catch {
      this.tryDelete(file);
      return;
    }
    this.queue.push({ id, file });
    this.tryStartNext();
  }

  cancel(): void {
    this.stopCurrent();
    for (const item of this.queue) this.tryDelete(item.file);
    this.queue = [];
  }

  shutdown(): void {
    this.active = false;
    this.cancel();
  }

  reset(): void {
    this.active = true;
  }

  onDrained(cb: () => void): () => void {
    this.listeners.drained.push(cb);
    return () => {
      const i = this.listeners.drained.indexOf(cb);
      if (i >= 0) this.listeners.drained.splice(i, 1);
    };
  }

  isPlaying(): boolean {
    return this.currentPlayer !== null;
  }

  private tryStartNext(): void {
    if (!this.active || this.currentPlayer || this.queue.length === 0) return;
    const next = this.queue.shift()!;
    let player: AudioPlayer;
    try {
      player = createAudioPlayer({ uri: next.file.uri });
    } catch {
      this.tryDelete(next.file);
      this.tryStartNext();
      return;
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try {
        sub?.remove?.();
      } catch {
        // listener already removed
      }
      try {
        (player as any).release?.();
        (player as any).remove?.();
      } catch {
        // resource already freed
      }
      this.tryDelete(next.file);
      if (this.currentPlayer === player) {
        this.currentPlayer = null;
        this.currentFile = null;
      }
      if (this.queue.length > 0) this.tryStartNext();
      else this.emitDrained();
    };
    const sub = player.addListener('playbackStatusUpdate', (status: any) => {
      if (status?.didJustFinish) finish();
    });
    this.currentPlayer = player;
    this.currentFile = next.file;
    try {
      player.play();
    } catch {
      finish();
    }
  }

  private stopCurrent(): void {
    const player = this.currentPlayer;
    const file = this.currentFile;
    this.currentPlayer = null;
    this.currentFile = null;
    if (player) {
      try {
        player.pause();
      } catch {
        // ignore
      }
      try {
        (player as any).release?.();
        (player as any).remove?.();
      } catch {
        // ignore
      }
    }
    if (file) this.tryDelete(file);
  }

  private tryDelete(file: File): void {
    try {
      if (file.exists) file.delete();
    } catch {
      // best-effort cleanup
    }
  }

  private emitDrained(): void {
    for (const cb of this.listeners.drained) {
      try {
        cb();
      } catch {
        // listener errors swallowed
      }
    }
  }
}
