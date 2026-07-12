# Medscope — Quick Setup & Architecture Overview

This document contains the core setup and run steps, followed by a concise but interviewer-friendly description of the app, architecture, and a short roadmap item describing the planned native ADPCM ↔ React Native audio bridge.

## Quick setup (core)

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
- Native features (USB serial, low-level TCP sockets) require running on a physical device and a prebuild (see commands above).

## What the app does (elevator pitch for interviewers)

Medscope is a mobile-first clinical capture platform that enables rapid, consistent acquisition of diagnostic-quality images and biosignals from either a smartphone or low-cost microcontroller devices. Captures are forwarded to configurable ML endpoints for automated analysis (imaging and audio) and the app stores results and metadata for clinician review.

Core user-facing flows
- Pharyngoscopy & Dermatoscopy: guided camera capture, send images to ML models, receive transformed images and predictions.
- Auscultation: record heart/lung sounds via phone mic or hardware device (USB/UDP), upload to analysis service and present results.
- ECG/demo streams: accept TCP/UDP streams from microcontrollers for real-time visualization and saving.

## Architecture (concise, technical)

High-level layers
- Presentation: React Native + Expo, `expo-router` for navigation.
- Capture components: `components/CameraInput.tsx` (phone camera) and per-screen capture handlers for device streams.
- Device I/O: TCP server (for microcontroller cameras), UDP listener (audio stream), and Android USB-serial integration for dedicated peripherals.
- Backend integration: multipart upload to ML/render endpoints using `axios`; endpoints are configured in `constants/api.ts`.

Camera flows
- Phone camera: `CameraView` (`expo-camera`) → `takePictureAsync()` → parent uploads/handles the image.
- Microcontroller camera: app opens a TCP server on the phone; the MCU connects as a TCP client and streams framed image bytes. The app accumulates frames, converts to a temporary file, and uploads to the model endpoint.

Auscultation flows
- Phone mic: `expo-av` for local recording and upload.
- UDP (Wi‑Fi): MCU streams audio chunks to a UDP port; app accumulates chunks framed by `AUDIO_START`/`AUDIO_END` markers.
- USB (Android): app enumerates devices, requests permission, sends commands (`START_REC`/`STOP_REC`) and receives base64 audio chunks via serial.

Native ADPCM ↔ React Native audio bridge (roadmap, concise)

Problem: raw PCM streaming from the MCU is bandwidth-heavy and has latency/cost implications. Solution: ADPCM encoded audio on the MCU plus native decode/playback in the app.

Planned approach:
- Implement a small Android native module (Kotlin) that bridges Bluest Android SDK ADPCM encode/decode/playback APIs to React Native.
- Expose streaming APIs so ADPCM chunks received over USB/UDP can be passed directly to native code for low-latency playback and optionally saved/decoded to WAV for ML upload.
- Benefits: reduced bandwidth, better MCU resource use, and native-quality playback while keeping the JS layer small.

## Where to look in the repo
- App entry & routing: `app/_layout.tsx`
- Phone camera: `components/CameraInput.tsx`
- Pharyngoscopy (camera TCP integration): `app/pharyngoscopy.tsx`
- Auscultation (USB/UDP/phone): `app/auscultation.tsx`
- Demo server / ECG mock: `services/TcpService.ts`

## Project specialties:
- Cross-cutting: touches UI, native modules, networking, and embedded firmware contracts.
- Clear impact: implement ADPCM bridge, improve framing/protocol robustness, or harden file upload pipelines.
- Demonstrates mobile craft: shipping native integrations, attention to performance, and careful UX for error states.
