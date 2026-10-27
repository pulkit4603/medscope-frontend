import {
  NativeEventEmitter,
  NativeModules,
  Platform,
  type EmitterSubscription,
} from "react-native";
import { Buffer } from "buffer";

type StethoscopeNative = {
  start: (ssid: string, password: string, port: number) => Promise<boolean>;
  stop: () => Promise<boolean>;
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
};

const native = NativeModules.StethoscopeWifi as StethoscopeNative | undefined;
const emitter = native ? new NativeEventEmitter(NativeModules.StethoscopeWifi) : null;

export const StethoscopeWifi = {
  isAvailable(): boolean {
    return Platform.OS === "android" && !!native;
  },

  start(ssid: string, password: string, port: number): Promise<boolean> {
    if (!native) {
      return Promise.reject(new Error("StethoscopeWifi is not available"));
    }
    return native.start(ssid, password, port);
  },

  stop(): Promise<boolean> {
    return native?.stop() ?? Promise.resolve(false);
  },

  onPacket(listener: (bytes: Uint8Array) => void): EmitterSubscription | null {
    return (
      emitter?.addListener("stethoscopePacket", (payload: { data?: string }) => {
        if (!payload?.data) return;
        listener(Uint8Array.from(Buffer.from(payload.data, "base64")));
      }) ?? null
    );
  },

  onStatus(
    listener: (status: string, address?: string) => void
  ): EmitterSubscription | null {
    return (
      emitter?.addListener(
        "stethoscopeStatus",
        (payload: { status?: string; address?: string }) => {
          if (payload?.status) listener(payload.status, payload.address);
        }
      ) ?? null
    );
  },
};
