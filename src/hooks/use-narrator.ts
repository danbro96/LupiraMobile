import { useCallback, useEffect, useRef, useState } from 'react';
import { KokoroClient } from '../api/kokoro-client';
import { PlaybackQueue } from '../audio/playback-queue';
import { ENDS_WITH_TERMINATOR, IDLE_FLUSH_MS, SENTENCE_BOUNDARY } from '../config';

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
  const idleFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<NarratorStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentSegmentText, setCurrentSegmentText] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [editorBuffer, setEditorBuffer] = useState('');

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
      if (idleFlushTimerRef.current) {
        clearTimeout(idleFlushTimerRef.current);
        idleFlushTimerRef.current = null;
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
      setEditorBuffer('');
    };
  }, [apiUrl, apiKey, voice, speed]);

  const cancelIdleFlush = () => {
    if (idleFlushTimerRef.current) {
      clearTimeout(idleFlushTimerRef.current);
      idleFlushTimerRef.current = null;
    }
  };

  const acceptInput = useCallback((next: string) => {
    const client = clientRef.current;
    cancelIdleFlush();

    if (!client) {
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
        if (!c) return;
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
    if (!client) return;
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

  return {
    status,
    errorMessage,
    currentSegmentText,
    isSpeaking,
    editorBuffer,
    acceptInput,
    speakRest,
    cancel,
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
