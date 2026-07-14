import { NativeModules, Platform } from "react-native";

type NativeAudioBridge = {
  startStreaming: () => Promise<boolean>;
  stopStreaming: () => Promise<boolean>;
  startRecording: (sessionName?: string) => Promise<string>;
  pushAdpcmChunkBase64: (base64Chunk: string) => Promise<boolean>;
  stopRecording: () => Promise<string>;
};

const moduleRef = NativeModules.AudioNativeModule as NativeAudioBridge | undefined;

const ensureAndroidBridge = (): NativeAudioBridge => {
  if (Platform.OS !== "android") {
    throw new Error("AudioNativeModule is only available on Android");
  }

  if (!moduleRef) {
    throw new Error("AudioNativeModule is not registered");
  }

  return moduleRef;
};

export const NativeAuscultationAudio = {
  isAvailable(): boolean {
    return Platform.OS === "android" && !!moduleRef;
  },

  startStreaming(): Promise<boolean> {
    return ensureAndroidBridge().startStreaming();
  },

  stopStreaming(): Promise<boolean> {
    return ensureAndroidBridge().stopStreaming();
  },

  startRecording(sessionName?: string): Promise<string> {
    return ensureAndroidBridge().startRecording(sessionName);
  },

  pushAdpcmChunkBase64(base64Chunk: string): Promise<boolean> {
    return ensureAndroidBridge().pushAdpcmChunkBase64(base64Chunk);
  },

  stopRecording(): Promise<string> {
    return ensureAndroidBridge().stopRecording();
  },
};
