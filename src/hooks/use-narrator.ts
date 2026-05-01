import { useCallback, useEffect, useRef, useState } from 'react';
import { KokoroClient } from '../api/kokoro-client';
import { PlaybackQueue } from '../audio/playback-queue';
import { FLUSH_DEBOUNCE_MS, SENTENCE_TERMINATORS } from '../config';

export type NarratorStatus = 'idle' | 'connecting' | 'ready' | 'error' | 'closed';

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
  const sentRef = useRef('');
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<NarratorStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentSegmentText, setCurrentSegmentText] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    if (!apiUrl || !apiKey) {
      setStatus('idle');
      return;
    }

    const client = new KokoroClient();
    const queue = new PlaybackQueue();
    clientRef.current = client;
    queueRef.current = queue;
    setErrorMessage(null);
    setStatus('connecting');

    const offOpen = client.on('open', () => {
      client.sendConfig(voice, speed);
      setStatus('ready');
    });
    const offClose = client.on('close', () => {
      setStatus('closed');
      setIsSpeaking(false);
    });
    const offError = client.on('error', (msg) => {
      setStatus('error');
      setErrorMessage(msg);
    });
    const offServerError = client.on('serverError', (m) => {
      setErrorMessage(m.message);
    });
    const offSegmentStart = client.on('segmentStart', (m) => {
      setCurrentSegmentText(m.text);
      setIsSpeaking(true);
    });
    const offSegmentEnd = client.on('segmentEnd', () => {
      // playback may still be in flight; isSpeaking flips off via drained
    });
    const offAudio = client.on('audio', (pcm) => {
      try {
        queue.enqueue(pcm);
      } catch (e) {
        setErrorMessage(String((e as Error)?.message ?? e));
      }
    });
    const offDrained = queue.onDrained(() => {
      setIsSpeaking(false);
      setCurrentSegmentText(null);
    });

    client.connect(apiUrl, apiKey);

    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      offOpen();
      offClose();
      offError();
      offServerError();
      offSegmentStart();
      offSegmentEnd();
      offAudio();
      offDrained();
      queue.shutdown();
      client.close();
      clientRef.current = null;
      queueRef.current = null;
      sentRef.current = '';
    };
  }, [apiUrl, apiKey, voice, speed]);

  const flush = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    clientRef.current?.sendFlush();
  }, []);

  const cancel = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    clientRef.current?.sendCancel();
    queueRef.current?.cancel();
    sentRef.current = '';
    setIsSpeaking(false);
    setCurrentSegmentText(null);
  }, []);

  const setText = useCallback(
    (full: string) => {
      const client = clientRef.current;
      if (!client) return;
      const previous = sentRef.current;
      if (full.startsWith(previous)) {
        const delta = full.slice(previous.length);
        if (delta.length > 0) {
          client.sendText(delta);
          sentRef.current = full;
        }
      } else {
        // user deleted / replaced text — drop pending audio and resync
        client.sendCancel();
        queueRef.current?.cancel();
        sentRef.current = full;
        if (full.length > 0) client.sendText(full);
      }

      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      if (SENTENCE_TERMINATORS.test(full)) {
        flushTimerRef.current = setTimeout(() => {
          flushTimerRef.current = null;
          client.sendFlush();
        }, FLUSH_DEBOUNCE_MS);
      }
    },
    []
  );

  return {
    status,
    errorMessage,
    currentSegmentText,
    isSpeaking,
    setText,
    flush,
    cancel,
  };
}
