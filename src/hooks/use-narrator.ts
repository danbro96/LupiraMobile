import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { KokoroClient } from '../api/kokoro-client';
import { PlaybackQueue } from '../audio/playback-queue';
import {
  ENDS_WITH_TERMINATOR,
  IDLE_FLUSH_MS,
  RECONNECT_INITIAL_MS,
  RECONNECT_MAX_MS,
  RECONNECT_MULTIPLIER,
  SENTENCE_BOUNDARY,
} from '../config';

export type NarratorStatus =
  | 'idle'
  | 'connecting'
  | 'reconnecting'
  | 'ready'
  | 'paused'
  | 'error';

type Options = {
  apiUrl: string;
  apiKey: string;
  voice: string;
  speed: number;
};

export function useNarrator(options: Options) {
  const { apiUrl, apiKey, voice, speed } = options;
  const clientRef = useRef<KokoroClient | null>(null);
  const queueRef = useRef<PlaybackQueue | null>(null);
  const idleFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectNowRef = useRef<() => void>(() => {});

  const [status, setStatus] = useState<NarratorStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentSegmentText, setCurrentSegmentText] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [editorBuffer, setEditorBuffer] = useState('');
  const [reconnectIn, setReconnectIn] = useState<number | null>(null);

  // Connection effect: rebuild WS only when credentials change.
  useEffect(() => {
    if (!apiUrl || !apiKey) {
      setStatus('idle');
      return;
    }

    let intentional = false;
    let reconnectDelay = RECONNECT_INITIAL_MS;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let countdownTimer: ReturnType<typeof setInterval> | null = null;
    let listenerOffs: Array<() => void> = [];

    const queue = new PlaybackQueue();
    queueRef.current = queue;
    const offDrained = queue.onDrained(() => {
      setIsSpeaking(false);
      setCurrentSegmentText(null);
    });

    const clearReconnectTimers = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
      setReconnectIn(null);
    };

    const detachListeners = () => {
      for (const off of listenerOffs) {
        try {
          off();
        } catch {
          // listener already gone
        }
      }
      listenerOffs = [];
    };

    const connect = () => {
      clearReconnectTimers();
      detachListeners();
      try {
        clientRef.current?.close();
      } catch {
        // previous client already disposed
      }
      const client = new KokoroClient();
      clientRef.current = client;
      setStatus('connecting');
      setErrorMessage(null);

      listenerOffs.push(
        client.on('open', () => {
          reconnectDelay = RECONNECT_INITIAL_MS;
          client.sendConfig(voice, speed);
          setStatus('ready');
        }),
        client.on('close', () => {
          if (intentional) return;
          scheduleReconnect();
        }),
        client.on('error', (msg) => {
          setErrorMessage(msg);
        }),
        client.on('serverError', (m) => {
          setErrorMessage(m.message);
        }),
        client.on('segmentStart', (m) => {
          setCurrentSegmentText(m.text);
          setIsSpeaking(true);
        }),
        client.on('segmentEnd', () => {
          // playback may still be in flight; isSpeaking flips off via drained
        }),
        client.on('audio', (pcm) => {
          try {
            queue.enqueue(pcm);
          } catch (e) {
            setErrorMessage(String((e as Error)?.message ?? e));
          }
        })
      );

      client.connect(apiUrl, apiKey);
    };

    const scheduleReconnect = () => {
      clearReconnectTimers();
      setStatus('reconnecting');
      const target = Date.now() + reconnectDelay;
      setReconnectIn(reconnectDelay);
      countdownTimer = setInterval(() => {
        const remaining = target - Date.now();
        if (remaining <= 0) {
          if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
          }
          setReconnectIn(0);
        } else {
          setReconnectIn(remaining);
        }
      }, 250);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        reconnectDelay = Math.min(reconnectDelay * RECONNECT_MULTIPLIER, RECONNECT_MAX_MS);
        connect();
      }, reconnectDelay);
    };

    reconnectNowRef.current = () => {
      reconnectDelay = RECONNECT_INITIAL_MS;
      intentional = false;
      connect();
    };

    const handleAppState = (next: AppStateStatus) => {
      if (next === 'active') {
        const c = clientRef.current;
        if (!c || !c.isOpen()) {
          reconnectDelay = RECONNECT_INITIAL_MS;
          intentional = false;
          connect();
        }
      } else if (next === 'background' || next === 'inactive') {
        intentional = true;
        clearReconnectTimers();
        try {
          clientRef.current?.close();
        } catch {
          // ignore
        }
        queue.cancel();
        setStatus('paused');
        setIsSpeaking(false);
        setCurrentSegmentText(null);
      }
    };

    const appStateSub = AppState.addEventListener('change', handleAppState);

    connect();

    return () => {
      intentional = true;
      clearReconnectTimers();
      detachListeners();
      appStateSub.remove();
      try {
        clientRef.current?.close();
      } catch {
        // ignore
      }
      clientRef.current = null;
      offDrained();
      queue.shutdown();
      queueRef.current = null;
      reconnectNowRef.current = () => {};
    };
  }, [apiUrl, apiKey]);

  // Push voice/speed updates without reconnecting.
  useEffect(() => {
    const c = clientRef.current;
    if (c && c.isOpen()) {
      c.sendConfig(voice, speed);
    }
  }, [voice, speed]);

  const cancelIdleFlush = () => {
    if (idleFlushTimerRef.current) {
      clearTimeout(idleFlushTimerRef.current);
      idleFlushTimerRef.current = null;
    }
  };

  const acceptInput = useCallback((next: string) => {
    cancelIdleFlush();
    const client = clientRef.current;
    if (!client || !client.isOpen()) {
      // not connected yet — keep what the user typed; we'll send when they edit again post-connect
      setEditorBuffer(next);
      return;
    }

    const { sent, remainder } = extractCompleted(next);
    if (sent.length > 0) {
      client.sendText(sent);
      client.sendFlush();
    }
    setEditorBuffer(remainder);

    if (remainder.length > 0 && ENDS_WITH_TERMINATOR.test(remainder)) {
      idleFlushTimerRef.current = setTimeout(() => {
        idleFlushTimerRef.current = null;
        const c = clientRef.current;
        if (!c || !c.isOpen()) return;
        setEditorBuffer((current) => {
          if (current.length === 0) return current;
          c.sendText(current);
          c.sendFlush();
          return '';
        });
      }, IDLE_FLUSH_MS);
    }
  }, []);

  const speakRest = useCallback(() => {
    cancelIdleFlush();
    const client = clientRef.current;
    if (!client || !client.isOpen()) return;
    setEditorBuffer((current) => {
      if (current.length === 0) return current;
      client.sendText(current);
      client.sendFlush();
      return '';
    });
  }, []);

  const cancel = useCallback(() => {
    cancelIdleFlush();
    clientRef.current?.sendCancel();
    queueRef.current?.cancel();
    setEditorBuffer('');
    setIsSpeaking(false);
    setCurrentSegmentText(null);
  }, []);

  const reconnectNow = useCallback(() => {
    reconnectNowRef.current();
  }, []);

  return {
    status,
    errorMessage,
    currentSegmentText,
    isSpeaking,
    editorBuffer,
    reconnectIn,
    acceptInput,
    speakRest,
    cancel,
    reconnectNow,
  };
}

function extractCompleted(text: string): { sent: string; remainder: string } {
  let sent = '';
  let remainder = text;
  while (true) {
    const match = SENTENCE_BOUNDARY.exec(remainder);
    if (!match) break;
    const boundaryEnd = match.index + match[0].length;
    sent += remainder.slice(0, boundaryEnd);
    remainder = remainder.slice(boundaryEnd);
  }
  return { sent, remainder };
}
