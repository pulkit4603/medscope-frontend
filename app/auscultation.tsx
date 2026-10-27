// filepath: /home/pulkit/dev/projects/team/major-project/medscope-frontend/app/auscultation.tsx
import React, { useState, useRef, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Platform,
  ScrollView,
  Modal,
  Dimensions,
  Alert,
  ActivityIndicator,
  PermissionsAndroid,
  BackHandler,
  Linking,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import { Audio } from "expo-av";
import { Asset } from "expo-asset";
import axios from "axios";
import dgram from "react-native-udp";
import { Buffer } from "buffer";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { NativeAuscultationAudio } from "../services/NativeAuscultationAudio";
import { StethoscopeWifi } from "../services/StethoscopeWifi";

// @ts-ignore
import {
  UsbSerial,
  UsbSerialManager,
} from "react-native-usb-serialport-for-android";

// USB Configuration for the microphone device
const USB_VENDOR_ID = 0x1234; // Replace with your device's vendor ID
const USB_PRODUCT_ID = 0x5678; // Replace with your device's product ID
const USB_BAUD_RATE = 115200;

// WiFi UDP Configuration
const UDP_PORT = 5000;
const STETHOSCOPE_SSID = "STM32_MIC";
const STETHOSCOPE_PASSWORD = "12345678";
// The board is the access point; its audio always comes from the AP address.
const STETHOSCOPE_BOARD_IP = "192.168.36.1";
const RECORD_WINDOW_MS = 10000;
// Firmware streams 8 kHz unsigned 8-bit mono PCM: one byte per sample.
const PCM_SAMPLE_RATE = 8000;
// Stop on sample count, not wall clock, so every take holds a full window
// even when packets arrive in bursts or the JS thread is busy.
const RECORD_WINDOW_BYTES = (RECORD_WINDOW_MS / 1000) * PCM_SAMPLE_RATE;
// Backstop in case the stream dies mid-take.
const RECORD_TIMEOUT_MS = RECORD_WINDOW_MS + 5000;
// The board sends a packet roughly every 32 ms; silence this long means it stopped.
const STREAM_STALE_MS = 2500;
// Peak deviation from 128 below this is a dead or disconnected mic.
const SILENCE_PEAK = 2;
const MIN_RECORDING_SECONDS = 1;
// The board broadcasts, and Wi-Fi never retransmits broadcast frames, so lost
// packets are the main risk. Above this share lost, a take sounds sped up and
// the model result can't be trusted.
const MAX_PACKET_LOSS = 0.1;
// Window for the live signal-quality readout.
const SIGNAL_WINDOW_MS = 3000;
const KEEP_AWAKE_TAG = "auscultation";

const parseAnalysis = (data: unknown): ApiResponse | null => {
  if (!data || typeof data !== "object") return null;

  const body = data as {
    label?: unknown;
    confidence?: unknown;
    status?: unknown;
    probabilities?: { Normal?: unknown; Abnormal?: unknown };
  };

  if (body.label !== "Normal" && body.label !== "Abnormal") return null;

  const normal = Number(body.probabilities?.Normal);
  const abnormal = Number(body.probabilities?.Abnormal);
  const confidence = Number(body.confidence);
  if (![normal, abnormal, confidence].every((value) => Number.isFinite(value))) {
    return null;
  }

  return {
    label: body.label,
    confidence,
    probabilities: { Normal: normal, Abnormal: abnormal },
    status: typeof body.status === "string" ? body.status : "ok",
  };
};

const linkStatusMessage = (status: string, live: boolean) => {
  if (live) {
    return "Stethoscope audio is arriving. Tap Start Recording. Capture lasts 10 seconds, or until you tap Stop.";
  }

  switch (status) {
    case "requesting":
      return "Confirm the prompt to join STM32_MIC. Leave mobile data on.";
    case "connected":
      return "Joined STM32_MIC. Waiting for the stethoscope to stream. Its PB12 light turns solid when it does. If PB12 blinks 5 times, power-cycle the board.";
    case "unavailable":
      return "Couldn't join STM32_MIC. In Wi-Fi settings connect to it with password 12345678, then reopen this screen.";
    case "lost":
      return "The stethoscope Wi-Fi dropped. Join STM32_MIC again.";
    case "permission":
      return "Allow nearby Wi-Fi access so the app can join the stethoscope while mobile data stays on.";
    default:
      return "Preparing the stethoscope connection.";
  }
};

const ensureStethoscopePermissions = async () => {
  if (Platform.OS !== "android") return false;

  try {
    const version = typeof Platform.Version === "number" ? Platform.Version : 0;
    if (version >= 33) {
      const result = await PermissionsAndroid.request(
        "android.permission.NEARBY_WIFI_DEVICES" as (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS]
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    }

    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: "Stethoscope Wi-Fi",
        message:
          "This Android version needs location permission to join the stethoscope Wi-Fi.",
        buttonPositive: "Allow",
        buttonNegative: "Cancel",
      }
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch (error) {
    console.warn("Stethoscope permission request failed:", error);
    return false;
  }
};

// Largest distance from the 8-bit midpoint, stopping early once it is clearly not silence.
const peakDeviation = (pcm: Uint8Array) => {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const deviation = Math.abs(pcm[i] - 128);
    if (deviation > peak) {
      peak = deviation;
      if (peak >= SILENCE_PEAK) break;
    }
  }
  return peak;
};

// Share of the expected 8 kHz stream that never arrived, from bytes seen over a span.
const lossOver = (bytes: number, elapsedMs: number) =>
  elapsedMs <= 0
    ? 0
    : Math.min(1, Math.max(0, 1 - bytes / ((elapsedMs / 1000) * PCM_SAMPLE_RATE)));

type StopReason = "user" | "complete" | "timeout";

const CONNECTION_MODE = {
  WIFI: "wifi",
  USB: "usb",
  PHONE: "phone",
} as const;

type ConnectionMode =
  (typeof CONNECTION_MODE)[keyof typeof CONNECTION_MODE];

// API Configuration
const AUSCULTATION_API_URL = "https://h3rsh-Heart.hf.space/predict";

// Audio storage directory
// @ts-ignore — expo-file-system.documentDirectory exists at runtime
const AUDIO_DIRECTORY = FileSystem.documentDirectory + "medscope-auscultation/";

// USB Commands
const USB_COMMANDS = {
  START_RECORDING: "START_REC\n",
  STOP_RECORDING: "STOP_REC\n",
  GET_STATUS: "STATUS\n",
  PING: "PING\n",
};

interface AudioItem {
  id: string;
  uri: string;
  timestamp: number;
  duration?: number;
  analysis?: {
    label: "Normal" | "Abnormal";
    confidence: number;
    probabilities: {
      Normal: number;
      Abnormal: number;
    };
    status: string;
  };
}

interface ApiResponse {
  label: "Normal" | "Abnormal";
  confidence: number;
  probabilities: {
    Normal: number;
    Abnormal: number;
  };
  status: string;
  debug_info?: any;
}

export default function AuscultationScreen() {
  const { testName } = useLocalSearchParams<{ testName: string }>();
  const recordingRef = useRef<Audio.Recording | null>(null);
  
  const soundRef = useRef<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // State for USB connection
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [usbDevice, setUsbDevice] = useState<any>(null);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [connectionMode, setConnectionMode] =
    useState<ConnectionMode>(CONNECTION_MODE.WIFI);
  const [streamLive, setStreamLive] = useState(false);
  const [linkStatus, setLinkStatus] = useState("starting");
  const [capturedSeconds, setCapturedSeconds] = useState(0);
  // Whole percent of the stream currently being lost; null until enough data to judge.
  const [signalLossPct, setSignalLossPct] = useState<number | null>(null);

  const udpSocketRef = useRef<any>(null);
  const udpConnectedRef = useRef(false);
  const lastPacketAtRef = useRef(0);
  // Every byte heard since the listener started, recording or not.
  const streamBytesRef = useRef(0);
  const signalSamplesRef = useRef<{ at: number; bytes: number }[]>([]);
  // Per-take timing, used to measure how much of the take was lost in the air.
  const takeFirstPacketAtRef = useRef(0);
  const takeLastPacketAtRef = useRef(0);
  const takeFirstChunkBytesRef = useRef(0);
  const stopReasonRef = useRef<StopReason>("user");
  const finishingRef = useRef(false);
  const mountedRef = useRef(true);
  // Bumped on every (re)join so a superseded join attempt can bail out.
  const linkGenerationRef = useRef(0);
  const permissionDeniedRef = useRef(false);
  const packetSubRef = useRef<{ remove: () => void } | null>(null);
  const statusSubRef = useRef<{ remove: () => void } | null>(null);
  const leaveGuardRef = useRef<() => void>(() => {});
  // Packet listeners outlive renders, so they call the latest finisher through a ref.
  const finishWifiRecordingRef = useRef<
    (reason?: StopReason) => Promise<void>
  >(async () => {});

  // State for audio recording and analysis
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [storedAudioFiles, setStoredAudioFiles] = useState<AudioItem[]>([]);
  const [selectedAudio, setSelectedAudio] = useState<AudioItem | null>(null);
  const [modalVisible, setModalVisible] = useState<boolean>(false);
  const [isReceivingData, setIsReceivingData] = useState<boolean>(false);
  const nativeRecordingActiveRef = useRef<boolean>(false);
  const nativeStreamingActiveRef = useRef<boolean>(false);

  // Packets are kept as a list and joined once, instead of re-copying the whole take per packet
  const receivedChunksRef = useRef<Uint8Array[]>([]);
  const receivedBytesRef = useRef(0);
  const recordingTimeoutRef = useRef<number | null>(null);

  // Use a ref to track receiving state synchronously (avoid React state staleness)
  const receivingRef = useRef<boolean>(false);
  // Keep USB subscription so we can remove it on cleanup
  const usbSubscriptionRef = useRef<any>(null);

  // Ensure Buffer is available globally for react-native-udp and encoding
  ;(globalThis as any).Buffer = Buffer;

  // Listen for the stethoscope's raw UDP audio stream
  useEffect(() => {
    mountedRef.current = true;

    const initializeApp = async () => {
      try {
        await setupDirectory();
        console.log("Audio directory setup completed");
        await loadSavedAudioFiles();
        console.log("Saved audio files loaded");
      } catch (error) {
        console.error("Audio storage setup failed:", error);
      }
      if (!mountedRef.current) return;
      await initializeUDPConnection();
    };

    initializeApp();

    // Drop the Live badge when packets stop, measure signal quality, and show capture progress.
    const ticker = setInterval(() => {
      const now = Date.now();
      if (
        udpConnectedRef.current &&
        now - lastPacketAtRef.current > STREAM_STALE_MS
      ) {
        udpConnectedRef.current = false;
        setStreamLive(false);
      }

      if (udpConnectedRef.current) {
        const samples = signalSamplesRef.current;
        samples.push({ at: now, bytes: streamBytesRef.current });
        while (samples.length > 1 && now - samples[0].at > SIGNAL_WINDOW_MS) {
          samples.shift();
        }
        const first = samples[0];
        const span = now - first.at;
        // Wait for two seconds of history so one late burst doesn't read as loss.
        const pct =
          span >= 2000
            ? Math.round(
                lossOver(streamBytesRef.current - first.bytes, span) * 100
              )
            : null;
        setSignalLossPct((current) => (current === pct ? current : pct));
      } else {
        signalSamplesRef.current = [];
        setSignalLossPct(null);
      }

      if (receivingRef.current) {
        setCapturedSeconds(receivedBytesRef.current / PCM_SAMPLE_RATE);
      }
    }, 500);

    return () => {
      mountedRef.current = false;
      linkGenerationRef.current++;
      receivingRef.current = false;
      clearInterval(ticker);
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
      if (recordingTimeoutRef.current !== null) {
        clearTimeout(recordingTimeoutRef.current);
      }
      if (usbDevice) {
        disconnectUSBDevice();
      }
      stopUDPConnection();
      void stopNativeRecordingSession();
      void soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
    };
  }, []);

  // Phones often stop delivering broadcast packets once the screen sleeps,
  // so keep it on while the stethoscope is streaming or a take is running.
  useEffect(() => {
    if (streamLive || isRecording) {
      void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    } else {
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    }
  }, [streamLive, isRecording]);

  const resetReceivedAudio = () => {
    receivedChunksRef.current = [];
    receivedBytesRef.current = 0;
  };

  const takeReceivedAudio = () => {
    const audio = new Uint8Array(receivedBytesRef.current);
    let offset = 0;
    for (const chunk of receivedChunksRef.current) {
      audio.set(chunk, offset);
      offset += chunk.length;
    }
    resetReceivedAudio();
    return audio;
  };

  // Request USB permissions (Android)
  const requestUSBPermissions = async () => {
    if (Platform.OS === "android") {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
          {
            title: "USB Permission",
            message:
              "App needs USB access to communicate with the microphone device",
            buttonNeutral: "Ask Me Later",
            buttonNegative: "Cancel",
            buttonPositive: "OK",
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } catch (err) {
        console.warn("USB permission error:", err);
        return false;
      }
    }
    return true;
  };

  const setupDirectory = async () => {
    const dirInfo = await FileSystem.getInfoAsync(AUDIO_DIRECTORY);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(AUDIO_DIRECTORY, {
        intermediates: true,
      });
    }
  };

  const isNativeAudioAvailable = () =>
    Platform.OS === "android" && NativeAuscultationAudio.isAvailable();

  const startNativeRecordingSession = async (sessionTag: string) => {
    if (!isNativeAudioAvailable()) return false;

    if (nativeRecordingActiveRef.current) {
      return true;
    }

    try {
      if (!nativeStreamingActiveRef.current) {
        await NativeAuscultationAudio.startStreaming();
        nativeStreamingActiveRef.current = true;
      }

      await NativeAuscultationAudio.startRecording(sessionTag);
      nativeRecordingActiveRef.current = true;
      return true;
    } catch (error) {
      console.error("Failed to start native recording session:", error);
      return false;
    }
  };

  const stopNativeRecordingSession = async () => {
    if (!isNativeAudioAvailable() || !nativeRecordingActiveRef.current) {
      return null;
    }

    try {
      const wavUri = await NativeAuscultationAudio.stopRecording();
      nativeRecordingActiveRef.current = false;
      return wavUri;
    } catch (error) {
      console.error("Failed to stop native recording session:", error);
      return null;
    } finally {
      if (nativeStreamingActiveRef.current) {
        try {
          await NativeAuscultationAudio.stopStreaming();
        } catch (error) {
          console.error("Failed to stop native streaming:", error);
        }
        nativeStreamingActiveRef.current = false;
      }
    }
  };

  const pushChunkToNativeAudio = (base64Chunk: string) => {
    if (!isNativeAudioAvailable() || !nativeRecordingActiveRef.current) return;
    void NativeAuscultationAudio.pushAdpcmChunkBase64(base64Chunk).catch(
      (error) => {
        console.error("Failed to push ADPCM chunk to native bridge:", error);
      }
    );
  };

  const loadSavedAudioFiles = async () => {
    try {
      const files = await FileSystem.readDirectoryAsync(AUDIO_DIRECTORY);
      const audioFiles = files.filter(
        (filename) => !filename.endsWith(".meta.json")
      );

      const audioItems = await Promise.all(
        audioFiles.map(async (filename) => {
          const fileUri = AUDIO_DIRECTORY + filename;
          const metadataPath = fileUri + ".meta.json";

          // Try to load analysis from metadata file
          let analysis = undefined;
          let duration = undefined;
          try {
            const metadataExists = await FileSystem.getInfoAsync(metadataPath);
            if (metadataExists.exists) {
              const metadataContent = await FileSystem.readAsStringAsync(
                metadataPath
              );
              const metadata = JSON.parse(metadataContent);
              analysis = metadata.analysis;
              duration = metadata.duration;
            }
          } catch (e) {
            console.log("No analysis found for", filename);
          }

          const timestamp = parseInt(
            filename.split("_")[1] || Date.now().toString()
          );
          return {
            id: filename,
            uri: fileUri,
            timestamp: timestamp,
            duration: duration,
            analysis: analysis,
          };
        })
      );

      // Sort by timestamp (newest first)
      setStoredAudioFiles(audioItems.sort((a, b) => b.timestamp - a.timestamp));
    } catch (error) {
      console.error("Failed to load audio files:", error);
    }
  };

  const saveAudioToDevice = async (
    uri: string,
    duration?: number,
    analysisData?: ApiResponse
  ) => {
    try {
      const timestamp = Date.now();
      const newFilename = `auscultation_${timestamp}.wav`;
      const newUri = AUDIO_DIRECTORY + newFilename;

      // Save the audio file
      await FileSystem.copyAsync({
        from: uri,
        to: newUri,
      });

      // If we have analysis data, save it to a metadata file
      if (analysisData || duration) {
        const metadataPath = newUri + ".meta.json";
        await FileSystem.writeAsStringAsync(
          metadataPath,
          JSON.stringify({
            analysis: analysisData,
            duration: duration,
          })
        );
      }

      const newAudio: AudioItem = {
        id: newFilename,
        uri: newUri,
        timestamp,
        duration: duration,
        analysis: analysisData,
      };

      setStoredAudioFiles((prevAudio) => [newAudio, ...prevAudio]);
      return newAudio;
    } catch (error) {
      console.error("Error saving audio:", error);
      return null;
    }
  };

  // `chunk` must be owned by the caller; it is stored without copying.
  const handleUDPData = (chunk: Uint8Array) => {
    try {
      if (chunk.length === 0) return;

      const now = Date.now();
      lastPacketAtRef.current = now;
      streamBytesRef.current += chunk.length;
      if (!udpConnectedRef.current) {
        udpConnectedRef.current = true;
        setStreamLive(true);
        setConnectionMode(CONNECTION_MODE.WIFI);
      }

      if (!receivingRef.current || finishingRef.current) return;

      const remaining = RECORD_WINDOW_BYTES - receivedBytesRef.current;
      if (remaining <= 0) return;

      const piece =
        chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      if (receivedBytesRef.current === 0) {
        takeFirstPacketAtRef.current = now;
        takeFirstChunkBytesRef.current = piece.length;
      }
      takeLastPacketAtRef.current = now;
      receivedChunksRef.current.push(piece);
      receivedBytesRef.current += piece.length;

      if (receivedBytesRef.current >= RECORD_WINDOW_BYTES) {
        void finishWifiRecordingRef.current("complete");
      }
    } catch (err) {
      console.log(err);
    }
  };

  const detachUDPListeners = () => {
    packetSubRef.current?.remove();
    statusSubRef.current?.remove();
    packetSubRef.current = null;
    statusSubRef.current = null;

    try {
      udpSocketRef.current?.close();
    } catch {}
    udpSocketRef.current = null;
  };

  const initializeUDPConnection = async () => {
    const generation = ++linkGenerationRef.current;
    const superseded = () =>
      !mountedRef.current || generation !== linkGenerationRef.current;

    detachUDPListeners();
    udpConnectedRef.current = false;
    setStreamLive(false);

    if (StethoscopeWifi.isAvailable()) {
      const allowed = await ensureStethoscopePermissions();
      // A second tap on "Try joining again" may have started a newer attempt meanwhile.
      if (superseded()) return;
      permissionDeniedRef.current = !allowed;

      // Clear again: a listener left over from an earlier attempt would deliver every packet twice.
      detachUDPListeners();
      packetSubRef.current = StethoscopeWifi.onPacket((bytes) => {
        handleUDPData(bytes);
      });
      // The board broadcasts, so this phone's own address no longer matters.
      statusSubRef.current = StethoscopeWifi.onStatus((status) => {
        if (status === "unavailable" && permissionDeniedRef.current) {
          setLinkStatus("permission");
          return;
        }
        setLinkStatus(status);
        if (status === "lost") {
          udpConnectedRef.current = false;
          setStreamLive(false);
        }
      });

      try {
        await StethoscopeWifi.start(
          STETHOSCOPE_SSID,
          STETHOSCOPE_PASSWORD,
          UDP_PORT
        );
        // Left the screen while the join was in flight: release the Wi-Fi request.
        if (!mountedRef.current) {
          void StethoscopeWifi.stop();
        }
        return;
      } catch (error) {
        console.log("Stethoscope Wi-Fi listener failed:", error);
        if (superseded()) return;
        setLinkStatus(permissionDeniedRef.current ? "permission" : "unavailable");
      }
    }

    try {
      console.log("Starting UDP listener...");
      const socket: any = dgram.createSocket({
        type: "udp4",
        reusePort: true,
      });

      udpSocketRef.current = socket;
      // Bind to all interfaces so broadcasts to 192.168.36.255 are delivered.
      socket.bind(UDP_PORT, "0.0.0.0");
      socket.on("message", (msg: Buffer, rinfo?: { address?: string }) => {
        // Drop anything not sent by the board. Strip the IPv4-mapped IPv6 prefix some stacks report.
        const sender = rinfo?.address?.replace(/^::ffff:/, "");
        if (sender !== STETHOSCOPE_BOARD_IP) return;
        handleUDPData(new Uint8Array(msg));
      });
      socket.on("error", (err: any) => {
        console.log("UDP error:", err);
      });
      setLinkStatus("connected");
    } catch (err) {
      console.log("UDP init failed:", err);
      setLinkStatus("unavailable");
    }
  };

  const stopUDPConnection = () => {
    detachUDPListeners();
    void StethoscopeWifi.stop().catch(() => {});
  };

  // Initialize USB connection to the microphone device
  const initializeUSBConnection = async () => {
    try {
      console.log("Initializing USB connection...");

      // Get list of USB devices
      const devices = await UsbSerialManager.list();
      console.log("Available USB devices:", devices);

      // Find our specific microphone device
      const micDevice = devices.find(
        (device) =>
          device.vendorId === USB_VENDOR_ID &&
          device.productId === USB_PRODUCT_ID
      );

      if (!micDevice) {
        console.log("USB microphone not found, switching to phone mic");
        setIsConnected(false);
        return;
      }

      // Request permission and connect
      const hasPermission = await UsbSerialManager.tryRequestPermission(
        micDevice.deviceId
      );

      if (!hasPermission) {
        console.log("USB permission denied, continuing in demo mode");
        return;
      }

      // Create USB serial connection - connection is opened automatically
      const device = new UsbSerial(micDevice.deviceId, {
        baudRate: USB_BAUD_RATE,
        parity: 0, // PARITY_NONE
        dataBits: 8, // DATA_BITS_8
        stopBits: 1, // STOP_BITS_1
      });

      setUsbDevice(device);
      setIsConnected(true);
      // Mark connection mode as USB
      setConnectionMode(CONNECTION_MODE.USB);
      // If USB connects, mark UDP as not connected for fallback logic
      udpConnectedRef.current = false;

      // Set up data listener - data comes as EventData which has a 'data' property
      const subscription = device.onReceived((event: any) => {
        // Convert EventData to string
        const dataString =
          typeof event === "string" ? event : event.data || String(event);
        handleReceivedUSBData(dataString);
      });

      // Keep reference to subscription for cleanup
      usbSubscriptionRef.current = subscription;

      // Send ping to test connection
      await sendUSBCommand(USB_COMMANDS.PING);

      console.log("USB microphone device connected successfully");
    } catch (error) {
        console.error("USB init failed:", error);
        setIsConnected(false);
      }
  };

  // Disconnect USB device
  const disconnectUSBDevice = async () => {
    try {
      if (usbDevice) {
        // Remove subscription if present
        try {
          if (usbSubscriptionRef.current) {
            usbSubscriptionRef.current.remove?.();
            usbSubscriptionRef.current.unsubscribe?.();
            usbSubscriptionRef.current = null;
          }
        } catch (e) {
          console.warn("Error removing USB subscription:", e);
        }

        await usbDevice.close();
        setUsbDevice(null);
        setIsConnected(false);
        console.log("USB device disconnected");
      }
    } catch (error) {
      console.error("Error disconnecting USB device:", error);
    }
  };

  // Send command to USB device
  const sendUSBCommand = async (command: string) => {
    try {
      if (!usbDevice || !isConnected) {
        throw new Error("USB device not connected");
      }

      console.log("Sending USB command:", command.trim());
      await usbDevice.send(command);
      return true;
    } catch (error) {
      console.error("Error sending USB command:", error);
      Alert.alert(
        "Communication Error",
        "Failed to send command to the device."
      );
      return false;
    }
  };

  //Start Phone Recording
  const startPhoneRecording = async () => {
  try {
    setIsRecording(true);
    setIsProcessing(false);

    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) {
      alert("Microphone permission is required");
      return;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const recording = new Audio.Recording();

    await recording.prepareToRecordAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY
    );

    await recording.startAsync();
    recordingRef.current = recording;

    console.log("Phone recording started");
  } catch (error) {
    console.error("Start recording error:", error);
  }
};

  //Stop recprding from phone
  const stopPhoneRecording = async () => {
  try {
    setIsRecording(false);
    setIsProcessing(true);

    if (!recordingRef.current) return;

    await recordingRef.current.stopAndUnloadAsync();
    const uri = recordingRef.current.getURI();

    recordingRef.current = null;

    if (uri) {
      await processCapturedAudio(uri);
    }
  } catch (error) {
    console.error("Stop recording error:", error);
    setIsProcessing(false);
  }
};

  // Handle received data from USB device
  const handleReceivedUSBData = (data: string) => {
    try {
      console.log("Received USB data length:", data.length);

      // Check if it's a status response
      if (
        data.startsWith("STATUS:") ||
        data.startsWith("PONG") ||
        data.startsWith("ACK")
      ) {
        console.log("Device status:", data.trim());
        return;
      }

      // Check if it's the start of audio data
      if (data.startsWith("AUDIO_START")) {
        console.log("Audio data transmission started");
        resetReceivedAudio();
        // Use ref to avoid dropped packets
        receivingRef.current = true;
        setIsReceivingData(true);
        void startNativeRecordingSession("usb");
        return;
      }

      // Check if it's the end of audio data
      if (data.startsWith("AUDIO_END")) {
        console.log("Audio data transmission completed");
        receivingRef.current = false;
        setIsReceivingData(false);
        void processReceivedAudio();
        return;
      }

      // If we're receiving audio data, accumulate it
      if (receivingRef.current) {
        const base64Chunk = data.trim();
        pushChunkToNativeAudio(base64Chunk);
      }
    } catch (error) {
      console.error("Error processing received USB data:", error);
    }
  };

  // Helper: detect if buffer contains a WAV header
  const isWavData = (data: Uint8Array) => {
    try {
      if (data.length < 12) return false;
      const riff = String.fromCharCode.apply(null, Array.from(data.slice(0, 4)));
      const wave = String.fromCharCode.apply(null, Array.from(data.slice(8, 12)));
      return riff === "RIFF" && wave === "WAVE";
    } catch (e) {
      return false;
    }
  };

  // Helper: wrap raw PCM bytes into a WAV container
  // This supports 8-bit unsigned PCM as well as 16-bit signed PCM.
  const pcmToWav = (
    pcmBytes: Uint8Array,
    opts: { sampleRate?: number; numChannels?: number; bitsPerSample?: number } = {}
  ) => {
    const sampleRate = opts.sampleRate || 16000;
    const numChannels = opts.numChannels || 1;
    const bitsPerSample = opts.bitsPerSample || 16;

    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcmBytes.length;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    let offset = 0;

    const writeString = (s: string) => {
      for (let i = 0; i < s.length; i++) {
        view.setUint8(offset++, s.charCodeAt(i));
      }
    };

    writeString("RIFF");
    view.setUint32(offset, 36 + dataSize, true);
    offset += 4;
    writeString("WAVE");
    writeString("fmt ");
    view.setUint32(offset, 16, true);
    offset += 4;
    view.setUint16(offset, 1, true); // PCM format
    offset += 2;
    view.setUint16(offset, numChannels, true);
    offset += 2;
    view.setUint32(offset, sampleRate, true);
    offset += 4;
    view.setUint32(offset, byteRate, true);
    offset += 4;
    view.setUint16(offset, blockAlign, true);
    offset += 2;
    view.setUint16(offset, bitsPerSample, true);
    offset += 2;
    writeString("data");
    view.setUint32(offset, dataSize, true);
    offset += 4;

    const uint8 = new Uint8Array(buffer);
    uint8.set(pcmBytes, 44);

    return uint8;
  };

  const processReceivedAudio = async () => {
    try {
      const nativeWavUri = await stopNativeRecordingSession();
      if (nativeWavUri) {
        resetReceivedAudio();
        receivingRef.current = false;
        setIsReceivingData(false);
        await processCapturedAudio(nativeWavUri);
        return;
      }

      const audioData = takeReceivedAudio();
      receivingRef.current = false;
      setIsReceivingData(false);

      if (audioData.length < PCM_SAMPLE_RATE * MIN_RECORDING_SECONDS) {
        console.log(`Recording too short: ${audioData.length} bytes`);
        setIsProcessing(false);
        Alert.alert(
          audioData.length === 0 ? "No audio received" : "Recording too short",
          audioData.length === 0
            ? `The stethoscope stopped sending before the take began. Check that it is powered on and this phone is still on ${STETHOSCOPE_SSID}, then record again.`
            : stopReasonRef.current === "timeout"
            ? "The stethoscope stopped sending after less than a second. Check that it is powered on and in range, then record again."
            : "Less than one second was recorded. Hold the stethoscope in place and let the take run longer."
        );
        return;
      }

      const duration = audioData.length / PCM_SAMPLE_RATE;

      // How much of the take was lost in the air. The first packet only marks the
      // start time, so its bytes are left out of the rate.
      const takeSpanMs =
        takeLastPacketAtRef.current - takeFirstPacketAtRef.current;
      const takeLoss =
        takeSpanMs >= 1000
          ? lossOver(audioData.length - takeFirstChunkBytesRef.current, takeSpanMs)
          : 0;
      const stoppedEarly =
        stopReasonRef.current === "timeout" &&
        audioData.length < RECORD_WINDOW_BYTES;

      console.log(`Processing ${audioData.length} bytes of audio data`);

      // If data already looks like a WAV, use as-is; otherwise wrap raw PCM into a WAV container
      let audioBytes: Uint8Array = audioData;
      if (!isWavData(audioData)) {
        console.log("Raw PCM detected — wrapping into WAV container (8kHz unsigned 8-bit mono)");
        audioBytes = pcmToWav(audioData, {
          sampleRate: PCM_SAMPLE_RATE,
          numChannels: 1,
          bitsPerSample: 8,
        });
      }

      // Convert to base64 using Buffer for reliability
      const base64String = Buffer.from(audioBytes).toString("base64");

      // Create a temporary file to save the audio
      const timestamp = Date.now();
      const tempFileName = `temp_audio_${timestamp}.wav`;
      // @ts-ignore — cacheDirectory is a runtime property of expo-file-system
      const tempUri = FileSystem.cacheDirectory + tempFileName;

      // Save the audio data to a file
      await FileSystem.writeAsStringAsync(tempUri, base64String, {
        encoding: FileSystem.EncodingType.Base64,
      });

      console.log("Audio saved to temporary file:", tempUri);

      try {
        // A flat line means the mic is dead or unplugged. Keep the take, but don't
        // hand silence to the model and show its Normal/Abnormal guess.
        if (peakDeviation(audioData) < SILENCE_PEAK) {
          const saved = await saveAudioToDevice(tempUri, duration);
          setIsProcessing(false);
          Alert.alert(
            "The stethoscope sent silence",
            saved
              ? "The Wi-Fi link works, but the microphone picked up nothing. Check the mic wiring on the board, then record again. This take was saved without analysis."
              : "The Wi-Fi link works, but the microphone picked up nothing. Check the mic wiring on the board, then record again."
          );
          return;
        }

        // A take with gaps or cut short still gets saved, but the user decides
        // whether its result is worth having.
        const problems: string[] = [];
        if (takeLoss > MAX_PACKET_LOSS) {
          problems.push(
            `About ${Math.round(takeLoss * 100)}% of the sound was lost over Wi-Fi, so the recording has gaps and the heart rate can sound faster than it is. Move the phone closer to the stethoscope.`
          );
        }
        if (stoppedEarly) {
          problems.push(
            `The stethoscope stopped sending after ${Math.floor(duration)} of ${RECORD_WINDOW_MS / 1000} seconds. Check its power and that the phone is in range.`
          );
        }

        if (problems.length > 0) {
          const saved = await saveAudioToDevice(tempUri, duration);
          setIsProcessing(false);
          if (!saved) {
            Alert.alert(
              "Save failed",
              "The recording could not be stored on this phone."
            );
            return;
          }
          Alert.alert(
            "Check this recording",
            `${problems.join("\n\n")}\n\nThe take is saved. Results from it may be unreliable.`,
            [
              { text: "Record again", style: "cancel" },
              {
                text: "Analyze anyway",
                onPress: () => {
                  void processCapturedAudio(saved.uri, saved);
                },
              },
            ]
          );
          return;
        }

        await processCapturedAudio(tempUri, null, duration);
      } finally {
        // processCapturedAudio already copied the file; a cleanup failure must not
        // show "Couldn't save" for a take that was saved.
        await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(
          () => {}
        );
      }
    } catch (error) {
      console.error("Error processing received audio:", error);
      setIsReceivingData(false);
      setIsProcessing(false);
      Alert.alert(
        "Couldn't save recording",
        "The audio arrived, but it could not be stored on this phone."
      );
    }
  };

  // Start recording via USB command
  const startRecording = async () => {
    try {
      if (!isConnected) {
        Alert.alert(
          "Not Connected",
          "Please connect the USB microphone device first."
        );
        return;
      }

      setIsRecording(true);
      setIsProcessing(true);

      await startNativeRecordingSession("usb-manual");

      const success = await sendUSBCommand(USB_COMMANDS.START_RECORDING);
      if (!success) {
        setIsRecording(false);
        setIsProcessing(false);
        await stopNativeRecordingSession();
        return;
      }

      console.log("Recording started via USB");

      // Set a timeout to automatically stop recording after 10 seconds
      recordingTimeoutRef.current = setTimeout(() => {
        stopRecording();
      }, 10000) as unknown as number;
    } catch (error) {
      console.error("Error starting recording:", error);
      setIsRecording(false);
      setIsProcessing(false);
    }
  };

  // Stop recording via USB command
  const stopRecording = async () => {
    try {
      if (recordingTimeoutRef.current !== null) {
        clearTimeout(recordingTimeoutRef.current);
        recordingTimeoutRef.current = null;
      }

      const success = await sendUSBCommand(USB_COMMANDS.STOP_RECORDING);
      if (success) {
        console.log("Recording stopped via USB");
      }

      setIsRecording(false);
      // Keep isProcessing true until we receive and process the audio data
    } catch (error) {
      console.error("Error stopping recording:", error);
      await stopNativeRecordingSession();
      setIsRecording(false);
      setIsProcessing(false);
    }
  };

  const clearRecordingTimer = () => {
    if (recordingTimeoutRef.current !== null) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
  };

  const finishWifiRecording = async (reason: StopReason = "user") => {
    if (finishingRef.current || !receivingRef.current) return;

    finishingRef.current = true;
    stopReasonRef.current = reason;
    clearRecordingTimer();
    receivingRef.current = false;
    setIsRecording(false);
    setIsReceivingData(false);
    setIsProcessing(true);

    try {
      await processReceivedAudio();
    } finally {
      finishingRef.current = false;
    }
  };
  finishWifiRecordingRef.current = finishWifiRecording;

  // Capture a window of the board's continuous UDP PCM stream
  const handleCapture = async () => {
    if (receivingRef.current) {
      await finishWifiRecording("user");
      return;
    }

    if (finishingRef.current) return;

    if (!streamLive) {
      Alert.alert(
        "No sound from the stethoscope yet",
        `Make sure this phone is on ${STETHOSCOPE_SSID} and the board's PB12 light is solid. If PB12 blinked 5 times, power-cycle the board and wait about 20 seconds.`
      );
      return;
    }

    resetReceivedAudio();
    takeFirstPacketAtRef.current = 0;
    takeLastPacketAtRef.current = 0;
    takeFirstChunkBytesRef.current = 0;
    stopReasonRef.current = "user";
    receivingRef.current = true;
    setConnectionMode(CONNECTION_MODE.WIFI);
    setIsRecording(true);
    setIsReceivingData(true);
    setIsProcessing(true);
    setCapturedSeconds(0);

    clearRecordingTimer();
    recordingTimeoutRef.current = setTimeout(() => {
      void finishWifiRecordingRef.current("timeout");
    }, RECORD_TIMEOUT_MS) as unknown as number;
  };

  leaveGuardRef.current = () => {
    Alert.alert(
      "Recording in progress",
      "This take has not been saved yet.",
      [
        { text: "Keep recording", style: "cancel" },
        {
          text: "Stop and save",
          onPress: () => {
            void finishWifiRecording("user");
          },
        },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            receivingRef.current = false;
            clearRecordingTimer();
            resetReceivedAudio();
            setIsRecording(false);
            setIsReceivingData(false);
            setIsProcessing(false);
            router.back();
          },
        },
      ]
    );
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (!receivingRef.current) return false;
        leaveGuardRef.current();
        return true;
      }
    );

    return () => subscription.remove();
  }, []);

  // Audio capture using real audio file from assets (fallback)
  // const useMockAudioCapture = async () => {
  //   try {
  //     setIsProcessing(true);

  //     // Load the real audio file from assets using Expo Asset
  //     const asset = Asset.fromModule(
  //       require("../assets/audio/sample_heart_sound.wav")
  //     );
  //     await asset.downloadAsync();

  //     // Create a temporary file to copy the asset to
  //     const timestamp = Date.now();
  //     const tempFileName = `audio_${timestamp}.wav`;
  //     const tempUri = FileSystem.documentDirectory + tempFileName;

  //     // Copy the asset file to the temporary location
  //     await FileSystem.copyAsync({
  //       from: asset.localUri || asset.uri,
  //       to: tempUri,
  //     });

  //     console.log("Real audio file loaded from assets:", tempUri);

  //     // Process the real audio file
  //     await processCapturedAudio(tempUri);

  //     // Clean up
  //     await FileSystem.deleteAsync(tempUri);
  //   } catch (error) {
  //     console.error("Error loading audio from assets:", error);
  //     Alert.alert(
  //       "Error",
  //       "Failed to load audio file from assets. Please ensure the audio file exists in assets/audio/sample_heart_sound.wav"
  //     );
  //     setIsProcessing(false);
  //   }
  // };


  const playAudio = async (uri: string) => {
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true }
      );

      soundRef.current = sound;
      setIsPlaying(true);

      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) {
          setIsPlaying(false);
        }
      });
    } catch (error) {
      console.error("Playback error:", error);
      setIsPlaying(false);
    }
  };

  const stopPlayback = async () => {
    const sound = soundRef.current;
    soundRef.current = null;
    setIsPlaying(false);
    if (!sound) return;
    try {
      await sound.stopAsync();
      await sound.unloadAsync();
    } catch (error) {
      console.warn("Stop playback error:", error);
    }
  };

  const closeModal = () => {
    setModalVisible(false);
    void stopPlayback();
  };



  const writeAnalysis = async (item: AudioItem, result: ApiResponse) => {
    const metadataPath = item.uri + ".meta.json";
    await FileSystem.writeAsStringAsync(
      metadataPath,
      JSON.stringify({
        analysis: result,
        duration: item.duration,
      })
    );

    const updated = { ...item, analysis: result };
    setStoredAudioFiles((current) =>
      current.map((audio) => (audio.id === item.id ? updated : audio))
    );
    setSelectedAudio(updated);
    setModalVisible(true);
  };

  // Save first, then analyze. A failed upload keeps the recording on the phone.
  const processCapturedAudio = async (
    uri: string,
    existingItem?: AudioItem | null,
    duration?: number
  ) => {
    let item = existingItem ?? null;
    setIsProcessing(true);

    if (!item) {
      item = await saveAudioToDevice(uri, duration);
    }

    if (!item) {
      setIsProcessing(false);
      Alert.alert(
        "Save failed",
        "The recording could not be stored on this phone."
      );
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", {
        uri: item.uri,
        type: "audio/wav",
        name: "recorded_audio.wav",
      } as any);

      const response = await axios({
        method: "POST",
        url: AUSCULTATION_API_URL,
        data: formData,
        headers: {
          "Content-Type": "multipart/form-data",
        },
        timeout: 30000,
      });

      const analysis = parseAnalysis(response.data);
      if (!analysis) {
        throw new Error("Unexpected analysis response");
      }

      await writeAnalysis(item, analysis);
    } catch (error) {
      console.error("API Error:", error);
      setSelectedAudio(item);
      setModalVisible(true);
      const unexpected =
        error instanceof Error &&
        error.message === "Unexpected analysis response";
      Alert.alert(
        "Recording saved",
        unexpected
          ? "The recording is stored, but the model did not return a Normal or Abnormal result. Tap Analyze to try again."
          : "The sound is stored on this phone. Analysis needs internet, and mobile data can stay on. Open the recording and tap Analyze."
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAudioPress = (audio: AudioItem) => {
    setSelectedAudio(audio);
    setModalVisible(true);
  };

  // Confirm before deleting an audio file
  const confirmDelete = (audioItem: AudioItem) => {
    Alert.alert(
      "Delete Audio",
      "Are you sure you want to delete this audio recording?",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          onPress: () => deleteAudio(audioItem),
          style: "destructive",
        },
      ],
      { cancelable: true }
    );
  };

  // Delete an audio file and its metadata
  const deleteAudio = async (audioItem: AudioItem) => {
    try {
      await stopPlayback();

      // Delete the audio file
      await FileSystem.deleteAsync(audioItem.uri, { idempotent: true });

      // Try to delete metadata file if it exists
      const metadataPath = audioItem.uri + ".meta.json";
      const metadataInfo = await FileSystem.getInfoAsync(metadataPath);
      if (metadataInfo.exists) {
        await FileSystem.deleteAsync(metadataPath);
      }

      // Remove the audio from the state
      setStoredAudioFiles((current) =>
        current.filter((item) => item.id !== audioItem.id)
      );

      // Close the modal if it was open
      setModalVisible(false);
      setSelectedAudio(null);
    } catch (error) {
      console.error("Failed to delete audio:", error);
      Alert.alert("Error", "Failed to delete the audio recording");
    }
  };

  // Format duration in seconds to mm:ss
  const formatDuration = (seconds?: number) => {
    if (!seconds) return "Unknown";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  // Render previous audio recordings
  const renderPreviousAudioFiles = () => {
    if (storedAudioFiles.length === 0) return null;

    return (
      <View style={styles.previousAudioContainer}>
        <Text style={styles.previousAudioTitle}>Previous Recordings</Text>
        <ScrollView
          style={styles.audioListContainer}
          contentContainerStyle={styles.audioListContent}
        >
          {storedAudioFiles.map((audio) => (
            <TouchableOpacity
              key={audio.id}
              style={styles.audioItem}
              onPress={() => handleAudioPress(audio)}
            >
              <View style={styles.audioIconContainer}>
                <Feather name="volume-2" size={24} color="#3B82F6" />
              </View>
              <View style={styles.audioInfo}>
                <Text style={styles.audioFileName}>
                  {new Date(audio.timestamp).toLocaleDateString()}{" "}
                  {new Date(audio.timestamp).toLocaleTimeString()}
                </Text>
                <Text style={styles.audioDuration}>
                  Duration: {formatDuration(audio.duration)}
                </Text>
                {audio.analysis ? (
                  <View
                    style={[
                      styles.analysisIndicator,
                      audio.analysis.label === "Normal"
                        ? styles.healthyIndicator
                        : styles.abnormalIndicator,
                    ]}
                  >
                    <Text style={styles.analysisIndicatorText}>
                      {audio.analysis.label}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.pendingText}>Saved · tap to analyze</Text>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            if (receivingRef.current) {
              leaveGuardRef.current();
              return;
            }
            router.back();
          }}
        >
          <Feather name="arrow-left" size={24} color="#1E293B" />
        </TouchableOpacity>
        <View style={styles.titleContainer}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{testName || "Auscultation"}</Text>
            <View
              style={[
                styles.connectionBadge,
                streamLive ? styles.wifiBadge : styles.phoneBadge,
              ]}
            >
              <Text style={styles.connectionBadgeText}>
                {streamLive ? "Live" : "Waiting"}
              </Text>
            </View>
          </View>
          <Text style={styles.subtitle}>
            Capture heart/lung sounds for analysis
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Guidance section */}
        <View style={styles.guidanceContainer}>
          <Text style={styles.guidanceTitle}>Auscultation Guidance</Text>
          <Text style={styles.guidanceText}>
            Leave mobile data on. The app joins {STETHOSCOPE_SSID} for sound
            and uses mobile data for analysis. Password {STETHOSCOPE_PASSWORD}.
            Several phones can listen at once.
          </Text>
          <Text style={streamLive ? styles.liveText : styles.warningText}>
            {linkStatusMessage(linkStatus, streamLive)}
          </Text>
          {streamLive && signalLossPct !== null && (
            <Text
              style={
                signalLossPct / 100 > MAX_PACKET_LOSS
                  ? styles.warningText
                  : styles.signalText
              }
            >
              {signalLossPct / 100 > MAX_PACKET_LOSS
                ? `Weak signal: about ${signalLossPct}% of the sound is being lost. Move the phone closer to the stethoscope before recording.`
                : "Signal good."}
            </Text>
          )}
          {!streamLive &&
            !isRecording &&
            (linkStatus === "unavailable" ||
              linkStatus === "lost" ||
              linkStatus === "permission") && (
              <TouchableOpacity
                style={styles.analyzeButton}
                onPress={() => {
                  setLinkStatus("requesting");
                  void initializeUDPConnection();
                }}
              >
                <Text style={styles.analyzeButtonText}>Try joining again</Text>
              </TouchableOpacity>
            )}
          {linkStatus === "permission" && (
            <TouchableOpacity
              style={styles.analyzeButton}
              onPress={() => {
                void Linking.openSettings();
              }}
            >
              <Text style={styles.analyzeButtonText}>Open app settings</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Capture section */}
        <View style={styles.captureContainer}>
          <TouchableOpacity
            style={[
              styles.captureButton,
              isRecording && styles.recordingButton,
            ]}
            onPress={handleCapture}
            disabled={isProcessing && !isRecording}
          >
            <View style={styles.captureButtonInner}>
              {isProcessing && !isRecording ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Feather
                    name={isRecording ? "stop-circle" : "mic"}
                    size={24}
                    color="#fff"
                  />
                  <Text style={styles.captureButtonText}>
                    {isRecording ? "Stop Recording" : "Start Recording"}
                  </Text>
                </>
              )}
            </View>
          </TouchableOpacity>


          {/* Recording indicator */}
          {isRecording && (
            <View style={styles.recordingIndicator}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>
                {streamLive
                  ? "Receiving stethoscope audio"
                  : "Stethoscope stopped sending"}{" "}
                · {Math.floor(capturedSeconds)}s of {RECORD_WINDOW_MS / 1000}s
              </Text>
            </View>
          )}
        </View>

        {/* Processing indicator */}
        {isProcessing && (
          <View style={styles.processingContainer}>
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text style={styles.processingText}>
              {isReceivingData
                ? "Receiving audio data..."
                : isRecording
                ? "Recording..."
                : "Analyzing audio..."}
            </Text>
          </View>
        )}

        {/* Previously captured audio files */}
        {renderPreviousAudioFiles()}
      </ScrollView>

      {/* Analysis Results Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={modalVisible}
        onRequestClose={closeModal}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={closeModal}
            >
              <Feather name="x" size={24} color="#64748B" />
            </TouchableOpacity>

            {selectedAudio && (
              <>
                <Text style={styles.modalTitle}>Audio Analysis Results</Text>

                {selectedAudio.analysis ? (
                  <View style={styles.resultContainer}>
                    <View
                      style={[
                        styles.analysisResult,
                        selectedAudio.analysis.label === "Normal"
                          ? styles.healthyResult
                          : styles.abnormalResult,
                      ]}
                    >
                      <Feather
                        name={
                          selectedAudio.analysis.label === "Normal"
                            ? "check-circle"
                            : "alert-circle"
                        }
                        size={30}
                        color="#fff"
                      />
                      <Text style={styles.analysisResultText}>
                        {selectedAudio.analysis.label === "Normal"
                          ? "Normal - Healthy Sounds"
                          : `Abnormal - Requires Attention`}
                      </Text>
                    </View>

                    <View style={styles.confidenceContainer}>
                      <Text style={styles.confidenceLabel}>
                        Overall Confidence
                      </Text>
                      <View style={styles.confidenceBarContainer}>
                        <View
                          style={[
                            styles.confidenceBar,
                            {
                              width: `${
                                Number.isFinite(
                                  selectedAudio.analysis.confidence
                                )
                                  ? selectedAudio.analysis.confidence * 100
                                  : 0
                              }%`,
                            },
                          ]}
                        />
                      </View>
                      <Text style={styles.confidenceValue}>
                        {Number.isFinite(selectedAudio.analysis.confidence)
                          ? `${Math.round(selectedAudio.analysis.confidence * 100)}%`
                          : "Unknown"}
                      </Text>
                    </View>

                    <View style={styles.probabilitiesContainer}>
                      <Text style={styles.probabilitiesTitle}>
                        Detailed Probabilities
                      </Text>
                      {Object.entries(
                        selectedAudio.analysis.probabilities ?? {}
                      ).map(([key, value]) => {
                        const numeric = Number(value);
                        if (!Number.isFinite(numeric)) return null;
                        return (
                          <View key={key} style={styles.probabilityItem}>
                            <Text style={styles.probabilityLabel}>
                              {key.charAt(0).toUpperCase() +
                                key.slice(1).replace(/_/g, " ")}
                            </Text>
                            <View style={styles.probabilityBarContainer}>
                              <View
                                style={[
                                  styles.probabilityBar,
                                  { width: `${numeric * 100}%` },
                                ]}
                              />
                            </View>
                            <Text style={styles.probabilityValue}>
                              {Math.round(numeric * 100)}%
                            </Text>
                          </View>
                        );
                      })}
                    </View>

                    <View style={styles.recommendationContainer}>
                      <Text style={styles.recommendationTitle}>
                        Recommendation
                      </Text>
                      <Text style={styles.recommendationText}>
                        {selectedAudio.analysis.label === "Normal"
                          ? "Normal heart/lung sounds detected. Continue regular monitoring and maintain good health practices."
                          : "Abnormal sounds detected. It is recommended to consult a healthcare professional for proper diagnosis and treatment."}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.noAnalysisContainer}>
                    <Text style={styles.noAnalysisText}>
                      This recording is saved on the phone. Analysis runs when
                      internet is available.
                    </Text>
                    <TouchableOpacity
                      style={styles.analyzeButton}
                      onPress={() => processCapturedAudio(selectedAudio.uri, selectedAudio)}
                      disabled={isProcessing}
                    >
                      <Text style={styles.analyzeButtonText}>
                        {isProcessing ? "Analyzing..." : "Analyze"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                <TouchableOpacity
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "#3B82F6",
                    paddingVertical: 10,
                    paddingHorizontal: 16,
                    borderRadius: 8,
                    marginTop: 10,
                  }}
                  onPress={() =>
                    isPlaying
                      ? stopPlayback()
                      : selectedAudio && playAudio(selectedAudio.uri)
                  }
                >
                  <Feather
                    name={isPlaying ? "square" : "play"}
                    size={18}
                    color="#fff"
                  />
                  <Text style={{ color: "#fff", marginLeft: 6 }}>
                    {isPlaying ? "Stop Playback" : "Play Recording"}
                  </Text>
                </TouchableOpacity>

                {/* Delete Button */}
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => confirmDelete(selectedAudio)}
                >
                  <Feather name="trash-2" size={18} color="#fff" />
                  <Text style={styles.deleteButtonText}>Delete Recording</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const { width } = Dimensions.get("window");

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight || 25 : 0,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  header: {
    padding: 16,
    paddingTop: 8,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  backButton: {
    marginRight: 16,
    marginTop: 4,
  },
  titleContainer: {
    flex: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#1E293B",
  },
  connectionBadge: {
    marginLeft: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(30, 41, 59, 0.12)",
    justifyContent: "center",
    alignItems: "center",
  },
  connectionBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1E293B",
  },
  wifiBadge: {
    backgroundColor: "rgba(59, 130, 246, 0.12)",
    borderColor: "#93C5FD",
  },
  usbBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    borderColor: "#6EE7B7",
  },
  phoneBadge: {
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderColor: "#FACC15",
  },
  subtitle: {
    fontSize: 16,
    color: "#64748B",
    marginTop: 4,
  },
  guidanceContainer: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  guidanceTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1E293B",
    marginBottom: 8,
  },
  guidanceText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#64748B",
  },
  warningText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#B45309",
    fontWeight: "600",
    marginTop: 12,
  },
  liveText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#15803D",
    fontWeight: "600",
    marginTop: 12,
  },
  signalText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#64748B",
    marginTop: 4,
  },
  pendingText: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: "600",
    color: "#B45309",
  },
  analyzeButton: {
    marginTop: 12,
    backgroundColor: "#3B82F6",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  analyzeButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  captureContainer: {
    alignItems: "center",
    marginBottom: 20,
    paddingHorizontal: 16,
  },
  captureButton: {
    backgroundColor: "#3B82F6",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  recordingButton: {
    backgroundColor: "#EF4444",
  },
  captureButtonInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  captureButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
  connectionStatus: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  connectedIndicator: {
    backgroundColor: "#22C55E",
  },
  disconnectedIndicator: {
    backgroundColor: "#EF4444",
  },
  statusText: {
    fontSize: 14,
    color: "#64748B",
  },
  recordingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    borderRadius: 20,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#EF4444",
    marginRight: 6,
  },
  recordingText: {
    fontSize: 14,
    color: "#EF4444",
    fontWeight: "500",
  },
  processingContainer: {
    alignItems: "center",
    marginTop: 10,
    marginBottom: 20,
  },
  processingText: {
    marginTop: 8,
    fontSize: 16,
    color: "#64748B",
    fontWeight: "500",
  },
  previousAudioContainer: {
    marginHorizontal: 16,
    marginTop: 10,
  },
  previousAudioTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1E293B",
    marginBottom: 10,
  },
  audioListContainer: {
    maxHeight: 300,
  },
  audioListContent: {
    paddingBottom: 5,
  },
  audioItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  audioIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#EFF6FF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  audioInfo: {
    flex: 1,
  },
  audioFileName: {
    fontSize: 16,
    fontWeight: "500",
    color: "#1E293B",
    marginBottom: 4,
  },
  audioDuration: {
    fontSize: 14,
    color: "#64748B",
    marginBottom: 6,
  },
  analysisIndicator: {
    alignSelf: "flex-start",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  healthyIndicator: {
    backgroundColor: "rgba(34, 197, 94, 0.1)",
  },
  abnormalIndicator: {
    backgroundColor: "rgba(239, 68, 68, 0.1)",
  },
  analysisIndicatorText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1E293B",
  },

  // Modal Styles
  modalContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    width: "90%",
    maxHeight: "80%",
  },
  closeButton: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F1F5F9",
    justifyContent: "center",
    alignItems: "center",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1E293B",
    marginBottom: 15,
    marginTop: 5,
    textAlign: "center",
  },
  resultContainer: {
    width: "100%",
  },
  analysisResult: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 15,
  },
  healthyResult: {
    backgroundColor: "#22C55E",
  },
  abnormalResult: {
    backgroundColor: "#EF4444",
  },
  analysisResultText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
    marginLeft: 8,
  },
  confidenceContainer: {
    marginBottom: 15,
  },
  confidenceLabel: {
    fontSize: 14,
    color: "#64748B",
    marginBottom: 6,
  },
  confidenceBarContainer: {
    height: 12,
    backgroundColor: "#F1F5F9",
    borderRadius: 6,
    overflow: "hidden",
    marginBottom: 4,
  },
  confidenceBar: {
    height: "100%",
    backgroundColor: "#3B82F6",
    borderRadius: 6,
  },
  confidenceValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1E293B",
    alignSelf: "flex-end",
  },
  probabilitiesContainer: {
    marginBottom: 15,
  },
  probabilitiesTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1E293B",
    marginBottom: 10,
  },
  probabilityItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  probabilityLabel: {
    fontSize: 14,
    color: "#64748B",
    width: 120,
  },
  probabilityBarContainer: {
    flex: 1,
    height: 8,
    backgroundColor: "#F1F5F9",
    borderRadius: 4,
    marginHorizontal: 8,
    overflow: "hidden",
  },
  probabilityBar: {
    height: "100%",
    backgroundColor: "#3B82F6",
    borderRadius: 4,
  },
  probabilityValue: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1E293B",
    width: 40,
    textAlign: "right",
  },
  recommendationContainer: {
    marginBottom: 15,
  },
  recommendationTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1E293B",
    marginBottom: 6,
  },
  recommendationText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EF4444",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 10,
  },
  deleteButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 6,
  },
  noAnalysisContainer: {
    padding: 16,
    alignItems: "center",
    marginBottom: 15,
  },
  noAnalysisText: {
    fontSize: 16,
    color: "#64748B",
    fontStyle: "italic",
  },
});
