export type ConfigMessage = { type: 'config'; voice?: string; speed?: number };
export type TextMessage = { type: 'text'; delta: string };
export type FlushMessage = { type: 'flush' };
export type CancelMessage = { type: 'cancel' };
export type ClientMessage = ConfigMessage | TextMessage | FlushMessage | CancelMessage;

export type SegmentStartMessage = { type: 'segment_start'; id: number; text: string };
export type SegmentEndMessage = { type: 'segment_end'; id: number };
export type ErrorMessage = { type: 'error'; message: string };
export type ServerMessage = SegmentStartMessage | SegmentEndMessage | ErrorMessage;

export type Voice = {
  id: string;
  name: string;
  language: string;
  gender: string;
};

export type OptionsResponse = {
  defaultVoice: string;
  speed: { min: number; max: number; default: number };
  maxTextLength: number;
  voices: Voice[];
  languages: string[];
  genders: string[];
};
