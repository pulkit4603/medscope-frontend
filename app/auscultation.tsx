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
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import { Audio } from "expo-av";
import { Asset } from "expo-asset";
import axios from "axios";
// @ts-ignore
import TcpSocket from "react-native-tcp-socket";

// TCP Socket Configuration
const TCP_HOST = "0.0.0.0";
const TCP_PORT = 8081; // Different port from pharyngoscopy
const AUSCULTATION_API_URL = "https://h3rsh-Heart.hf.space/predict";

// Audio storage directory
const AUDIO_DIRECTORY = FileSystem.documentDirectory + "medscope-auscultation/";

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

  // State for TCP connection
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [tcpServer, setTcpServer] = useState<any>(null);
  const [clientSocket, setClientSocket] = useState<any>(null);

  // State for audio recording and analysis
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [storedAudioFiles, setStoredAudioFiles] = useState<AudioItem[]>([]);
  const [selectedAudio, setSelectedAudio] = useState<AudioItem | null>(null);
  const [modalVisible, setModalVisible] = useState<boolean>(false);
  const [receivedAudioData, setReceivedAudioData] = useState<Uint8Array>(
    new Uint8Array()
  );
  const [isReceivingData, setIsReceivingData] = useState<boolean>(false);
  const [currentAudioIndex, setCurrentAudioIndex] = useState<number>(0);

  // Audio files in the specified order
  const audioFiles = [
    { name: "abnormal1.wav", path: require("../assets/audio/abnormal1.wav") },
    { name: "abnormal2.wav", path: require("../assets/audio/abnormal2.wav") },
    { name: "normal1.wav", path: require("../assets/audio/normal1.wav") },
    { name: "normal2.wav", path: require("../assets/audio/normal2.wav") },
  ];

  // Use ref for accumulating audio data
  const receivedAudioDataRef = useRef<Uint8Array>(new Uint8Array());

  // Setup directory and initialize TCP server
  useEffect(() => {
    const initializeApp = async () => {
      await setupDirectory();
      console.log("Audio directory setup completed");
      await loadSavedAudioFiles();
      console.log("Saved audio files loaded");
      initializeTcpSocket();
    };

    initializeApp();

    return () => {
      // Cleanup socket on unmount
      if (tcpServer) {
        tcpServer.close();
      }
    };
  }, []);

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

  // Initialize TCP server for audio reception
  const initializeTcpSocket = () => {
    try {
      const server = TcpSocket.createServer(function (socket) {
        console.log("Audio client connected:", socket.address());
        setIsConnected(true);
        setClientSocket(socket);

        socket.on("data", (data: string | Buffer) => {
          const uint8Data = new Uint8Array(data as Buffer);
          console.log(`Received ${uint8Data.length} bytes of audio data`);
          handleReceivedAudioData(uint8Data);
        });

        socket.on("error", (error: any) => {
          console.error("Audio client socket error:", error);
          setIsConnected(false);
          setClientSocket(null);
        });

        socket.on("close", () => {
          console.log("Audio client disconnected");
          setIsConnected(false);
          setClientSocket(null);
        });
      }).listen({ port: TCP_PORT, host: TCP_HOST });

      server.on("error", (error: any) => {
        console.error("TCP audio server error:", error);
        Alert.alert(
          "Server Error",
          "Failed to start TCP audio server. Please check if the port is available."
        );
      });

      server.on("close", () => {
        console.log("TCP audio server closed");
        setIsConnected(false);
        setTcpServer(null);
        setClientSocket(null);
      });

      setTcpServer(server);
      console.log(`TCP audio server listening on ${TCP_HOST}:${TCP_PORT}`);
    } catch (error) {
      console.error("Failed to initialize TCP audio server:", error);
      Alert.alert("Server Error", "Failed to initialize TCP audio server.");
    }
  };

  // Handle received audio data from TCP socket
  const handleReceivedAudioData = async (data: Uint8Array) => {
    try {
      setIsReceivingData(true);

      // Accumulate received data
      const currentData = receivedAudioDataRef.current;
      const newData = new Uint8Array(currentData.length + data.length);
      newData.set(currentData);
      newData.set(data, currentData.length);

      receivedAudioDataRef.current = newData;
      setReceivedAudioData(newData);

      console.log(
        `Received ${data.length} bytes, total: ${newData.length} bytes`
      );

      // Check for audio file terminator or sufficient data
      // For simplicity, let's assume we receive the complete audio file in chunks
      // and process it after a short delay without new data
      setTimeout(() => {
        if (receivedAudioDataRef.current.length > 0) {
          processReceivedAudio();
        }
      }, 1000); // Wait 1 second for more data
    } catch (error) {
      console.error("Error processing received audio data:", error);
      Alert.alert("Error", "Failed to process audio from device.");
      receivedAudioDataRef.current = new Uint8Array();
      setReceivedAudioData(new Uint8Array());
      setIsProcessing(false);
      setIsReceivingData(false);
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

  // Handle audio capture - always use real audio from assets
  const handleCapture = async () => {
    // Always use the real audio file from assets
    await useMockAudioCapture();
  };

  // Audio capture using real audio file from assets
  const useMockAudioCapture = async () => {
    try {
      setIsProcessing(true);

      // Get current audio file
      const currentAudioFile = audioFiles[currentAudioIndex];
      console.log(
        `Loading audio file: ${currentAudioFile.name} (index: ${currentAudioIndex})`
      );

      // Load the real audio file from assets using Expo Asset
      const asset = Asset.fromModule(currentAudioFile.path);
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

      console.log(
        `Audio file ${currentAudioFile.name} loaded from assets:`,
        tempUri
      );

      // Process the real audio file
      await processCapturedAudio(tempUri);

      // Move to next audio file for next capture (cycle through the array)
      setCurrentAudioIndex((prevIndex) => (prevIndex + 1) % audioFiles.length);

      // Clean up
      await FileSystem.deleteAsync(tempUri);
    } catch (error) {
      console.error("Error loading audio from assets:", error);
      Alert.alert(
        "Error",
        "Failed to load audio file from assets. Please ensure the audio files exist in assets/audio/ folder"
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
        name: "sample_heart_sound.wav",
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
            Place the stethoscope on the appropriate area (chest for heart
            sounds, back/chest for lung sounds). Ensure a quiet environment and
            steady positioning during recording.
          </Text>
        </View>

        {/* Capture section */}
        <View style={styles.captureContainer}>
          <TouchableOpacity
            style={styles.captureButton}
            onPress={handleCapture}
            disabled={isProcessing || isReceivingData}
          >
            <View style={styles.captureButtonInner}>
              {isProcessing || isReceivingData ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Feather name="mic" size={24} color="#fff" />
                  <Text style={styles.captureButtonText}>
                    Record Demo Audio
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
              Demo mode - Using sample audio from assets
            </Text>
          </View>
        </View>

        {/* Processing indicator */}
        {(isProcessing || isReceivingData) && (
          <View style={styles.processingContainer}>
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text style={styles.processingText}>
              {isReceivingData ? "Receiving audio..." : "Analyzing audio..."}
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
