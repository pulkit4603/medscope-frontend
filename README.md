# Medscope — Complete Project README

This README describes the Medscope mobile app: what it does, how it is structured, how to set it up and run it, and where to look in the codebase.

## Table of contents

- Project summary
- Features
- Architecture overview
- Setup & run (core)
- Configuration
- Development workflow
- Testing
- File map (where to find important code)
- Auscultation ADPCM bridge (roadmap + design)
- Security & privacy
- Roadmap & contribution guidance

## Project summary

Medscope is a cross-platform (Android/iOS/web) mobile application for capturing clinical images and biosignals from smartphones and embedded microcontrollers, sending them to ML services for automated analysis, and presenting results with stored metadata for clinician review. It emphasizes reproducible capture flows, low-bandwidth embedded communication, and clear separation between capture, transport, and model inference.

## Features

- Guided camera capture for pharyngoscopy and dermatoscopy
- Auscultation capture modes: phone mic, Wi‑Fi/UDP streams, and Android USB serial
- Real-time/demo ECG and biosignal stream support (mocked for web/dev)
- Local storage of captures and analysis metadata
- Configurable ML endpoints for image/audio analysis

## Architecture overview

High-level components:

- UI & navigation: `expo-router` and React Native screens under `app/`
- Capture components: `components/` contains reusable UI such as `CameraInput.tsx`
- Device I/O: `services/` and in-screen socket/USB handlers for TCP/UDP/USB
- Backend integration: HTTP upload/analysis via `axios`, endpoints configured in `constants/api.ts`
- Native modules: planned Kotlin native module for ADPCM/Blust SDK integration (Android)

Design principles:

- Keep device protocol handling isolated from UI logic
- Fail fast with dev mocks but provide robust error states for production
- Favor native processing for low-latency audio playback and heavy binary processing

## Setup & run (core)

Prerequisites

- Android Studio (or Xcode for iOS) and command-line SDK tools
- Node.js and npm

Environment

- Ensure Android SDK tools are on your `PATH` and `ANDROID_HOME` is set.

Install dependencies

```bash
npm install
npm install --global @expo/ngrok@^4.1.0
npm install -g @expo/cli eas-cli
```

Build and run (Android)

```bash
npx expo prebuild --clean
npx expo run:android
```

Notes

- Native features (USB serial, low-level TCP sockets) require running on a physical device and a prebuild.

## Configuration

- Primary runtime configuration is located at `constants/api.ts`. Set your staging/production endpoints there. Do not commit secrets or private API keys.
- Additional device constants (ports, USB IDs) are set in the relevant screen files (e.g., `app/auscultation.tsx`, `app/pharyngoscopy.tsx`) and should be parameterized for production.

## Development workflow

- Use feature branches and open PRs with focused changes.
- Run the app locally with Expo for UI work; run `npx expo prebuild` when changing native dependencies.
- Use `services/TcpService.ts` for local device mocks (ECG stream, demo data) to develop without hardware.

## Testing

- Unit tests: Jest is configured (`jest-expo` preset). Run `npm test`.
- Component tests: existing basic tests in `components/__tests__` — expand coverage incrementally.
- Manual device tests: for USB/TCP/UDP flows test on Android device connected to the same hotspot or via USB debugging.

## File map — quick references

- `app/_layout.tsx` — app entry and router setup
- `components/CameraInput.tsx` — phone camera capture component
- `app/pharyngoscopy.tsx` — microcontroller camera TCP capture & upload
- `app/dermatoscopy.tsx` — skin imaging flow
- `app/auscultation.tsx` — audio capture (phone/UDP/USB) and upload
- `services/TcpService.ts` — demo TCP server and ECG mock data
- `constants/api.ts` — endpoint configuration

## Auscultation ADPCM bridge (roadmap + design)

Goal

- Reduce bandwidth and improve playback latency for auscultation by using ADPCM encoding on the microcontroller and native decoding/playback on Android using the Bluest SDK.

Planned implementation (concise)

1. Create an Android native module (Kotlin) exposing Bluest SDK ADPCM encode/decode/playback.
2. Provide a streaming API: JS can push ADPCM chunks received over USB/UDP directly to native playback (bypassing JS decoding for low latency).
3. Expose utilities to transcode ADPCM→WAV for ML server uploads when needed.

Why native

- ADPCM decode/playback as native code avoids GC pauses, reduces JS memory copies, and lets the audio pipeline run with lower latency and CPU overhead.

Developer notes for the bridge

- Keep JS surface minimal: start/stop playback, feedChunk(buffer), saveDecoded(filename).
- Handle errors and provide events for playback status and buffer underrun/overflow.

## Security & privacy

- Treat all patient data as sensitive. Use secure storage and end-to-end encrypted transport to ML backends in production.
- Avoid committing API keys and sensitive endpoints to the repo. Use CI secrets or environment config for deployments.

## Roadmap & contribution guidance

Short term

- Implement ADPCM native bridge (Android)
- Harden TCP/UDP framing and add length-prefixed frames + checksum
- Add retry/backoff for network uploads and clear retry UI

Medium term

- CI pipelines, E2E hardware emulation tests, production readiness checklist

How to contribute

- Fork, implement a focused change, open PR with description and tests where applicable.
