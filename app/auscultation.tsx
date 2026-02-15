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
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import { Audio } from "expo-av";
import { Asset } from "expo-asset";
import axios from "axios";
// @ts-ignore
import {
  UsbSerial,
  UsbSerialManager,
} from "react-native-usb-serialport-for-android";

// USB Configuration for the microphone device
const USB_VENDOR_ID = 0x1234; // Replace with your device's vendor ID
const USB_PRODUCT_ID = 0x5678; // Replace with your device's product ID
const USB_BAUD_RATE = 115200;

// API Configuration
const AUSCULTATION_API_URL = "https://h3rsh-Heart.hf.space/predict";

// Audio storage directory
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

  // State for USB connection
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [usbDevice, setUsbDevice] = useState<any>(null);
  const [isRecording, setIsRecording] = useState<boolean>(false);

  // State for audio recording and analysis
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [storedAudioFiles, setStoredAudioFiles] = useState<AudioItem[]>([]);
  const [selectedAudio, setSelectedAudio] = useState<AudioItem | null>(null);
  const [modalVisible, setModalVisible] = useState<boolean>(false);
  const [receivedAudioData, setReceivedAudioData] = useState<Uint8Array>(
    new Uint8Array()
  );
  const [isReceivingData, setIsReceivingData] = useState<boolean>(false);

  // Use ref for accumulating audio data
  const receivedAudioDataRef = useRef<Uint8Array>(new Uint8Array());
  const recordingTimeoutRef = useRef<number | null>(null);

  // Setup directory and initialize USB connection
  useEffect(() => {
    const initializeApp = async () => {
      await requestUSBPermissions();
      await setupDirectory();
      console.log("Audio directory setup completed");
      await loadSavedAudioFiles();
      console.log("Saved audio files loaded");
      await initializeUSBConnection();
    };

    initializeApp();

    return () => {
      // Cleanup USB connection on unmount
      if (usbDevice) {
        disconnectUSBDevice();
      }
    };
  }, []);

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
        console.log("Microphone device not found");
        // Don't show alert in silent mode, just log
        console.log("USB microphone not found, continuing in demo mode");
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

      // Set up data listener - data comes as EventData which has a 'data' property
      const subscription = device.onReceived((event: any) => {
        // Convert EventData to string
        const dataString =
          typeof event === "string" ? event : event.data || String(event);
        handleReceivedUSBData(dataString);
      });

      // Send ping to test connection
      await sendUSBCommand(USB_COMMANDS.PING);

      console.log("USB microphone device connected successfully");
    } catch (error) {
      console.error("Failed to initialize USB connection:", error);
      // Don't show alert, just continue in demo mode
      console.log("Continuing in demo mode");
    }
  };

  // Disconnect USB device
  const disconnectUSBDevice = async () => {
    try {
      if (usbDevice) {
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
        receivedAudioDataRef.current = new Uint8Array();
        setIsReceivingData(true);
        return;
      }

      // Check if it's the end of audio data
      if (data.startsWith("AUDIO_END")) {
        console.log("Audio data transmission completed");
        setIsReceivingData(false);
        processReceivedAudio();
        return;
      }

      // If we're receiving audio data, accumulate it
      if (isReceivingData) {
        // Convert received string data to Uint8Array
        // Assuming the device sends base64 encoded audio data
        try {
          const binaryString = atob(data);
          const audioChunk = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            audioChunk[i] = binaryString.charCodeAt(i);
          }

          // Accumulate audio data
          const currentData = receivedAudioDataRef.current;
          const newData = new Uint8Array(
            currentData.length + audioChunk.length
          );
          newData.set(currentData);
          newData.set(audioChunk, currentData.length);

          receivedAudioDataRef.current = newData;
          setReceivedAudioData(newData);

          console.log(`Accumulated ${newData.length} bytes of audio data`);
        } catch (decodeError) {
          console.error("Error decoding audio data:", decodeError);
        }
      }
    } catch (error) {
      console.error("Error processing received USB data:", error);
    }
  };

  const processReceivedAudio = async () => {
    try {
      const audioData = receivedAudioDataRef.current;

      if (audioData.length === 0) {
        console.log("No audio data to process");
        return;
      }

      console.log(`Processing ${audioData.length} bytes of audio data`);

      // Convert to base64 for saving
      const base64String = btoa(
        String.fromCharCode.apply(null, Array.from(audioData))
      );

      // Create a temporary file to save the audio
      const timestamp = Date.now();
      const tempFileName = `temp_audio_${timestamp}.wav`;
      const tempUri = FileSystem.documentDirectory + tempFileName;

      // Save the audio data to a file
      await FileSystem.writeAsStringAsync(tempUri, base64String, {
        encoding: FileSystem.EncodingType.Base64,
      });

      console.log("Audio saved to temporary file:", tempUri);

      // Reset received data for next capture
      receivedAudioDataRef.current = new Uint8Array();
      setReceivedAudioData(new Uint8Array());
      setIsReceivingData(false);

      // Process the captured audio
      await processCapturedAudio(tempUri);

      // Clean up temporary file
      await FileSystem.deleteAsync(tempUri);
    } catch (error) {
      console.error("Error processing received audio:", error);
      setIsReceivingData(false);
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

      const success = await sendUSBCommand(USB_COMMANDS.START_RECORDING);
      if (!success) {
        setIsRecording(false);
        setIsProcessing(false);
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
      setIsRecording(false);
      setIsProcessing(false);
    }
  };

  // Handle audio capture - use USB recording or fallback to demo
  const handleCapture = async () => {
    if (isConnected) {
      if (isRecording) {
        await stopRecording();
      } else {
        await startRecording();
      }
    } else {
      // Fallback to demo audio when USB is not connected
      await useMockAudioCapture();
    }
  };

  // Audio capture using real audio file from assets (fallback)
  const useMockAudioCapture = async () => {
    try {
      setIsProcessing(true);

      // Load the real audio file from assets using Expo Asset
      const asset = Asset.fromModule(
        require("../assets/audio/sample_heart_sound.wav")
      );
      await asset.downloadAsync();

      // Create a temporary file to copy the asset to
      const timestamp = Date.now();
      const tempFileName = `audio_${timestamp}.wav`;
      const tempUri = FileSystem.documentDirectory + tempFileName;

      // Copy the asset file to the temporary location
      await FileSystem.copyAsync({
        from: asset.localUri || asset.uri,
        to: tempUri,
      });

      console.log("Real audio file loaded from assets:", tempUri);

      // Process the real audio file
      await processCapturedAudio(tempUri);

      // Clean up
      await FileSystem.deleteAsync(tempUri);
    } catch (error) {
      console.error("Error loading audio from assets:", error);
      Alert.alert(
        "Error",
        "Failed to load audio file from assets. Please ensure the audio file exists in assets/audio/sample_heart_sound.wav"
      );
      setIsProcessing(false);
    }
  };

  // Process the captured audio through the API
  const processCapturedAudio = async (uri: string) => {
    try {
      // Create FormData for multipart upload
      const formData = new FormData();
      formData.append("file", {
        uri: uri,
        type: "audio/wav",
        name: "recorded_audio.wav",
      } as any);

      console.log("API Request:", {
        url: AUSCULTATION_API_URL,
        method: "POST",
        headers: { "Content-Type": "multipart/form-data" },
        audioUri: uri,
      });

      // Make request to the API
      const response = await axios({
        method: "POST",
        url: AUSCULTATION_API_URL,
        data: formData,
        headers: {
          "Content-Type": "multipart/form-data",
        },
        timeout: 30000, // 30 second timeout
      });

      console.log("API Response:", response.data);

      const result: ApiResponse = response.data;

      // Save the audio with analysis results
      const savedAudio = await saveAudioToDevice(uri, undefined, result);
      if (savedAudio) {
        setSelectedAudio(savedAudio);
        setModalVisible(true);
      }
    } catch (error) {
      console.error("API Error:", error);
      Alert.alert(
        "API Error",
        "Failed to analyze audio. Please check your internet connection and try again."
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
      // Delete the audio file
      await FileSystem.deleteAsync(audioItem.uri);

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
                {audio.analysis && (
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
          onPress={() => router.back()}
        >
          <Feather name="arrow-left" size={24} color="#1E293B" />
        </TouchableOpacity>
        <View style={styles.titleContainer}>
          <Text style={styles.title}>{testName || "Auscultation"}</Text>
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
            {isConnected
              ? "Place the USB microphone on the appropriate area (chest for heart sounds, back/chest for lung sounds). Ensure a quiet environment during recording."
              : "Connect the USB microphone device to record audio, or use demo mode with sample audio."}
          </Text>
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
                    name={
                      isRecording ? "stop-circle" : isConnected ? "mic" : "play"
                    }
                    size={24}
                    color="#fff"
                  />
                  <Text style={styles.captureButtonText}>
                    {isRecording
                      ? "Stop Recording"
                      : isConnected
                      ? "Start Recording"
                      : "Play Demo Audio"}
                  </Text>
                </>
              )}
            </View>
          </TouchableOpacity>

          {/* Connection status indicator */}
          <View style={styles.connectionStatus}>
            <View
              style={[
                styles.statusIndicator,
                isConnected
                  ? styles.connectedIndicator
                  : styles.disconnectedIndicator,
              ]}
            />
            <Text style={styles.statusText}>
              {isConnected
                ? "USB Microphone Connected"
                : "USB Microphone Disconnected - Demo Mode"}
            </Text>
          </View>

          {/* Recording indicator */}
          {isRecording && (
            <View style={styles.recordingIndicator}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>Recording in progress...</Text>
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
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setModalVisible(false)}
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
                                selectedAudio.analysis.confidence * 100
                              }%`,
                            },
                          ]}
                        />
                      </View>
                      <Text style={styles.confidenceValue}>
                        {Math.round(selectedAudio.analysis.confidence * 100)}%
                      </Text>
                    </View>

                    <View style={styles.probabilitiesContainer}>
                      <Text style={styles.probabilitiesTitle}>
                        Detailed Probabilities
                      </Text>
                      {Object.entries(selectedAudio.analysis.probabilities).map(
                        ([key, value]) => (
                          <View key={key} style={styles.probabilityItem}>
                            <Text style={styles.probabilityLabel}>
                              {key.charAt(0).toUpperCase() +
                                key.slice(1).replace(/_/g, " ")}
                            </Text>
                            <View style={styles.probabilityBarContainer}>
                              <View
                                style={[
                                  styles.probabilityBar,
                                  { width: `${value * 100}%` },
                                ]}
                              />
                            </View>
                            <Text style={styles.probabilityValue}>
                              {Math.round(value * 100)}%
                            </Text>
                          </View>
                        )
                      )}
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
                      No analysis results available
                    </Text>
                  </View>
                )}

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
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#1E293B",
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
