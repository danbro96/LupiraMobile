# LupiraMobile

React Native (Expo + TypeScript) client for the [KokoroApi](https://github.com/danbro96/KokoroApi) WebSocket TTS service.

The first feature is a **live narrator while you write**: type into the editor and each completed sentence is spoken back as soon as `.`, `!`, or `?` is typed, exercising the streaming endpoint at `wss://tts.lupira.com/tts/stream`.

## Architecture

```
App.tsx
  └── src/screens/NarratorScreen.tsx
        ├── src/components/ScriptEditor.tsx     ← multiline TextInput
        ├── src/components/VoicePicker.tsx      ← Modal + FlatList; loads voices via /options
        ├── src/components/SpeedPicker.tsx      ← 0.75x / 1.0x / 1.25x / 1.5x chips
        ├── src/components/SettingsForm.tsx     ← API URL + key, on first launch
        └── src/hooks/use-narrator.ts           ← glue: client + audio queue
              ├── src/api/kokoro-client.ts      ← typed WebSocket wrapper
              ├── src/api/types.ts              ← wire-protocol types
              └── src/audio/playback-queue.ts   ← per-segment WAV playback via expo-audio
                    └── src/audio/pcm-to-wav.ts ← int16 24 kHz mono PCM → WAV bytes
```

State (API URL, key, voice, speed) lives in `src/store/settings-store.ts` (Zustand) and is persisted via `expo-secure-store`.

## Running locally

```sh
npm install
npx expo start
```

Scan the QR code from Expo Go on a phone on the same LAN. On first launch, paste:
- **WebSocket URL**: `wss://tts.lupira.com/tts/stream`
- **API key**: the 64-hex-char key for your KokoroApi instance

Both are stored in iOS Keychain / Android Keystore, never in plain AsyncStorage.

## Wire protocol

Mirrored from KokoroApi's `src/KokoroApi/Endpoints/StreamEndpoint.cs`. Snake_case JSON over text frames, raw int16 LE PCM @ 24 kHz mono over binary frames.

| Direction | Frame | Shape |
|---|---|---|
| Client → server | text | `{type:'config', voice?, speed?}` |
| Client → server | text | `{type:'text', delta}` |
| Client → server | text | `{type:'flush'}` |
| Client → server | text | `{type:'cancel'}` |
| Server → client | text | `{type:'segment_start', id, text}` |
| Server → client | binary | int16 LE PCM bytes for that segment |
| Server → client | text | `{type:'segment_end', id}` |
| Server → client | text | `{type:'error', message}` |

## Audio playback approach

React Native has no WebAudio, so we don't stream raw PCM directly. Each `segment_end` finalises a chunk of PCM bytes that we wrap with a 44-byte WAV header (24 kHz, mono, 16-bit), write to the cache directory as a base64 WAV file, and play sequentially via `expo-audio`'s `createAudioPlayer`. Granularity is sentence-level — matches what the API actually emits.

If sub-segment latency ever matters, the next step is a custom native module that feeds PCM straight to `AudioTrack` (Android) / `AudioQueue` (iOS) — at which point the project would need to leave the Expo managed workflow.

## Out of scope for v1

- EAS Build + iOS TestFlight + Android Play Store.
- Background audio + lock-screen controls (needs `UIBackgroundModes: audio` on iOS and a foreground service on Android).
- The other three concept ideas: article reader, voice notes via share sheet, language pronunciation trainer.
- Server-side Opus/Ogg streaming (would simplify RN audio significantly — see KokoroApi README "Future" section).

## Repo layout

```
LupiraMobile/
├── App.tsx                          entry
├── app.json                         Expo config
├── package.json
├── tsconfig.json
├── src/
│   ├── api/                         WS client + wire types
│   ├── audio/                       PCM → WAV → expo-audio queue
│   ├── components/                  presentational + form components
│   ├── hooks/
│   ├── screens/                     NarratorScreen (the only screen for v1)
│   ├── store/                       Zustand + secure-store
│   └── config.ts                    constants
└── assets/                          icon, splash
```
