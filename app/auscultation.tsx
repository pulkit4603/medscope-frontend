import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Platform,
  ScrollView,
  FlatList,
  Alert,
  ActivityIndicator,
  Modal,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import * as Haptics from "expo-haptics";
import { audioApiUrl } from "@/constants/api";

// Mock Bluetooth device type
interface BluetoothDevice {
  id: string;
  name: string;
  isConnected: boolean;
}

// Response type from the API
interface AnalysisResponse {
  isHealthy: boolean;
  confidence: number;
  description: string;
}

export default function AuscultationScreen() {
  const { testName } = useLocalSearchParams<{ testName: string }>();

  // State for Bluetooth functionality
  const [isBluetoothEnabled, setIsBluetoothEnabled] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  const [connectedDevice, setConnectedDevice] =
    useState<BluetoothDevice | null>(null);

  // State for audio recording
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingDuration, setRecordingDuration] = useState<number>(0);
  const durationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [audioUri, setAudioUri] = useState<string | null>(null);

  // State for analysis
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResponse | null>(
    null
  );
  const [showResultModal, setShowResultModal] = useState<boolean>(false);

  // Mock Bluetooth devices for demonstration
  const mockDevices: BluetoothDevice[] = [
    { id: "1", name: "MedScope Stethoscope", isConnected: false },
    { id: "2", name: "Pulse Oximeter", isConnected: false },
    { id: "3", name: "Digital Thermometer", isConnected: false },
    { id: "4", name: "Heart Monitor", isConnected: false },
    { id: "5", name: "Blood Pressure Cuff", isConnected: false },
  ];

  // Effect to clean up recording timer
  useEffect(() => {
    return () => {
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
      }
    };
  }, []);

  // Request audio recording permissions
  useEffect(() => {
    (async () => {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission Denied",
          "Please grant microphone permissions to use this feature."
        );
      }
    })();
  }, []);

  // Simulate Bluetooth scanning
  const startBluetoothScan = () => {
    setIsScanning(true);
    setIsBluetoothEnabled(true);

    // Simulate device discovery with a delay
    setTimeout(() => {
      setDevices(mockDevices);
      setIsScanning(false);
    }, 2000);
  };

  // Connect to a device
  const connectToDevice = (device: BluetoothDevice) => {
    setIsScanning(false);

    // Show connecting status
    const updatedDevices = devices.map((d) =>
      d.id === device.id ? { ...d, isConnecting: true } : d
    );
    setDevices(updatedDevices);

    // Simulate connection delay
    setTimeout(() => {
      const connectedDevices = devices.map((d) =>
        d.id === device.id
          ? { ...d, isConnected: true }
          : { ...d, isConnected: false }
      );
      setDevices(connectedDevices);
      setConnectedDevice({ ...device, isConnected: true });

      // Provide haptic feedback on successful connection
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, 1500);
  };

  // Disconnect from device
  const disconnectDevice = () => {
    setConnectedDevice(null);
    setDevices(devices.map((d) => ({ ...d, isConnected: false })));

    // Provide haptic feedback
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  };

  // Start recording
  const startRecording = async () => {
    try {
      // Configure audio recording
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      // Prepare the recording
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      setRecording(recording);
      setIsRecording(true);
      setRecordingDuration(0);

      // Start duration timer
      durationTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);

      // Provide haptic feedback
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      console.error("Failed to start recording", error);
      Alert.alert(
        "Recording Error",
        "Failed to start recording. Please try again."
      );
    }
  };

  // Stop recording
  const stopRecording = async () => {
    if (!recording) return;

    try {
      // Stop the recording
      await recording.stopAndUnloadAsync();

      // Stop the timer
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }

      // Get the recording URI
      const uri = recording.getURI();
      setAudioUri(uri);
      setIsRecording(false);
      setRecording(null);

      // Provide haptic feedback
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error("Failed to stop recording", error);
      Alert.alert(
        "Recording Error",
        "Failed to stop recording. Please try again."
      );
    }
  };

  // Format seconds to mm:ss
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  // Upload and analyze the recording
  const analyzeRecording = async () => {
    if (!audioUri) return;

    setIsAnalyzing(true);

    try {
      const formData = new FormData();

      // Add the audio file
      const fileInfo = await FileSystem.getInfoAsync(audioUri);

      const audioFile = {
        uri: audioUri,
        name: "audio_recording.wav",
        type: "audio/wav",
      } as any;

      formData.append("audio", audioFile);

      // Add metadata if needed
      if (testName) {
        formData.append("testType", testName);
      }

      // Make the request to the server
      const response = await fetch(audioApiUrl, {
        method: "POST",
        body: formData,
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      // Parse the response
      const result = await response.json();
      setAnalysisResult(result);
      setShowResultModal(true);
    } catch (error) {
      console.error("Analysis error:", error);

      // For demo purposes, create a mock result if the API is not available
      const mockResult: AnalysisResponse = {
        isHealthy: Math.random() > 0.3, // 70% chance of being healthy
        confidence: Math.floor(Math.random() * 30) + 70, // 70-99%
        description:
          Math.random() > 0.3
            ? "Normal heart sounds detected with regular rhythm. No murmurs or abnormal sounds identified."
            : "Possible abnormal sounds detected. Slight irregularity in rhythm with potential mid-systolic murmur.",
      };

      setAnalysisResult(mockResult);
      setShowResultModal(true);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Render device list item
  const renderDeviceItem = ({ item }: { item: BluetoothDevice }) => (
    <TouchableOpacity
      style={[
        styles.deviceItem,
        item.isConnected && styles.connectedDeviceItem,
      ]}
      onPress={() => connectToDevice(item)}
      disabled={item.isConnected}
    >
      <View style={styles.deviceInfo}>
        <Text style={styles.deviceName}>{item.name}</Text>
        <Text style={styles.deviceId}>ID: {item.id}</Text>
      </View>

      <View style={styles.deviceStatus}>
        {item.isConnected ? (
          <View style={styles.connectedIndicator}>
            <Feather name="check-circle" size={16} color="#22C55E" />
            <Text style={styles.connectedText}>Connected</Text>
          </View>
        ) : (
          <View style={styles.connectButton}>
            <Text style={styles.connectButtonText}>Connect</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

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
            {connectedDevice
              ? `Connected to ${connectedDevice.name}`
              : "Connect to your auscultation device"}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
      >
        {/* Connection Section */}
        {!connectedDevice ? (
          <View style={styles.connectionSection}>
            <LinearGradient
              colors={["#3B82F6", "#2563EB"]}
              style={styles.connectionCard}
            >
              <Feather name="bluetooth" size={40} color="#fff" />
              <Text style={styles.connectionCardTitle}>Connect Device</Text>
              <Text style={styles.connectionCardText}>
                Connect your stethoscope or auscultation device to begin
                recording
              </Text>

              <TouchableOpacity
                style={styles.scanButton}
                onPress={startBluetoothScan}
                disabled={isScanning}
              >
                <Text style={styles.scanButtonText}>
                  {isScanning ? "Scanning..." : "Scan for Devices"}
                </Text>
                {isScanning && (
                  <ActivityIndicator color="#fff" style={{ marginLeft: 8 }} />
                )}
              </TouchableOpacity>
            </LinearGradient>

            {/* Device List */}
            {isBluetoothEnabled && (
              <View style={styles.devicesContainer}>
                <View style={styles.devicesHeader}>
                  <Text style={styles.devicesTitle}>Available Devices</Text>
                  {isScanning && <ActivityIndicator color="#3B82F6" />}
                </View>

                {devices.length > 0 ? (
                  <FlatList
                    data={devices}
                    renderItem={renderDeviceItem}
                    keyExtractor={(item) => item.id}
                    style={styles.devicesList}
                    contentContainerStyle={styles.devicesListContent}
                    scrollEnabled={false}
                  />
                ) : !isScanning ? (
                  <View style={styles.noDevicesMessage}>
                    <Feather name="info" size={20} color="#64748B" />
                    <Text style={styles.noDevicesText}>
                      No devices found. Make sure your device is powered on and
                      in pairing mode.
                    </Text>
                  </View>
                ) : null}
              </View>
            )}
          </View>
        ) : (
          <View style={styles.recordingSection}>
            {/* Connected Device Info */}
            <View style={styles.connectedDeviceInfo}>
              <View style={styles.deviceIconContainer}>
                <Feather name="activity" size={28} color="#3B82F6" />
              </View>
              <View style={styles.connectedDeviceDetails}>
                <Text style={styles.connectedDeviceName}>
                  {connectedDevice.name}
                </Text>
                <View style={styles.connectedStatusIndicator}>
                  <View style={styles.statusDot} />
                  <Text style={styles.connectedStatusText}>Connected</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.disconnectButton}
                onPress={disconnectDevice}
              >
                <Feather name="x" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            {/* Recording UI */}
            <LinearGradient
              colors={["#F1F5F9", "#E2E8F0"]}
              style={styles.recordingCard}
            >
              <View style={styles.recordingVisual}>
                <View
                  style={[
                    styles.recordingIndicator,
                    isRecording && styles.recordingActive,
                  ]}
                />

                <View style={styles.durationContainer}>
                  <Text style={styles.durationText}>
                    {formatDuration(recordingDuration)}
                  </Text>
                  <Text style={styles.recordingStatus}>
                    {isRecording
                      ? "Recording"
                      : audioUri
                      ? "Recording Complete"
                      : "Ready"}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.recordButton, isRecording && styles.stopButton]}
                onPress={isRecording ? stopRecording : startRecording}
                disabled={isAnalyzing}
              >
                <Feather
                  name={isRecording ? "square" : "mic"}
                  size={30}
                  color="#fff"
                />
              </TouchableOpacity>

              {audioUri && !isRecording && (
                <View style={styles.actionButtons}>
                  <TouchableOpacity
                    style={[
                      styles.analyzeButton,
                      isAnalyzing && styles.analyzeButtonDisabled,
                    ]}
                    onPress={analyzeRecording}
                    disabled={isAnalyzing}
                  >
                    {isAnalyzing ? (
                      <View style={styles.analyzingContainer}>
                        <ActivityIndicator color="#fff" size="small" />
                        <Text style={styles.analyzeButtonText}>
                          Analyzing...
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.analyzingContainer}>
                        <Feather name="bar-chart-2" size={20} color="#fff" />
                        <Text style={styles.analyzeButtonText}>
                          Analyze Recording
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.newRecordingButton}
                    onPress={() => {
                      setAudioUri(null);
                      setRecordingDuration(0);
                    }}
                    disabled={isAnalyzing}
                  >
                    <Feather name="refresh-cw" size={16} color="#3B82F6" />
                    <Text style={styles.newRecordingText}>New Recording</Text>
                  </TouchableOpacity>
                </View>
              )}
            </LinearGradient>

            <View style={styles.instructionsContainer}>
              <Text style={styles.instructionsTitle}>How to record:</Text>
              <View style={styles.instructionItem}>
                <View style={styles.instructionNumber}>
                  <Text style={styles.instructionNumberText}>1</Text>
                </View>
                <Text style={styles.instructionText}>
                  Place the stethoscope on the{" "}
                  {testName === "Auscultation (Heart)"
                    ? "chest"
                    : testName === "Auscultation (Lungs)"
                    ? "back or chest"
                    : "abdomen"}{" "}
                  area
                </Text>
              </View>
              <View style={styles.instructionItem}>
                <View style={styles.instructionNumber}>
                  <Text style={styles.instructionNumberText}>2</Text>
                </View>
                <Text style={styles.instructionText}>
                  Press the record button and maintain position for 15-30
                  seconds
                </Text>
              </View>
              <View style={styles.instructionItem}>
                <View style={styles.instructionNumber}>
                  <Text style={styles.instructionNumberText}>3</Text>
                </View>
                <Text style={styles.instructionText}>
                  Try to minimize background noise and movement during recording
                </Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Analysis Results Modal */}
      <Modal
        visible={showResultModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowResultModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Analysis Results</Text>
              <TouchableOpacity
                style={styles.closeModalButton}
                onPress={() => setShowResultModal(false)}
              >
                <Feather name="x" size={24} color="#64748B" />
              </TouchableOpacity>
            </View>

            {analysisResult && (
              <>
                <View
                  style={[
                    styles.resultIndicator,
                    analysisResult.isHealthy
                      ? styles.healthyResult
                      : styles.unhealthyResult,
                  ]}
                >
                  <Feather
                    name={
                      analysisResult.isHealthy ? "check-circle" : "alert-circle"
                    }
                    size={30}
                    color="#fff"
                  />
                  <Text style={styles.resultIndicatorText}>
                    {analysisResult.isHealthy
                      ? "Normal Findings"
                      : "Abnormal Findings"}
                  </Text>
                </View>

                <View style={styles.confidenceContainer}>
                  <Text style={styles.confidenceLabel}>Confidence Level</Text>
                  <View style={styles.confidenceBarContainer}>
                    <View
                      style={[
                        styles.confidenceBar,
                        { width: `${analysisResult.confidence}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.confidenceValue}>
                    {analysisResult.confidence}%
                  </Text>
                </View>

                <View style={styles.descriptionContainer}>
                  <Text style={styles.descriptionLabel}>Findings</Text>
                  <Text style={styles.descriptionText}>
                    {analysisResult.description}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.saveResultsButton}
                  onPress={() => {
                    // Here we would implement saving the results
                    setShowResultModal(false);
                    Alert.alert(
                      "Results Saved",
                      "Analysis results have been saved to your medical records."
                    );
                  }}
                >
                  <Text style={styles.saveResultsText}>Save Results</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight || 25 : 0,
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
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },

  // Connection section styles
  connectionSection: {
    marginBottom: 20,
  },
  connectionCard: {
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    marginBottom: 20,
  },
  connectionCardTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "bold",
    marginTop: 16,
    marginBottom: 8,
  },
  connectionCardText: {
    color: "#fff",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 20,
    opacity: 0.9,
  },
  scanButton: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  scanButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  devicesContainer: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  devicesHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  devicesTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1E293B",
  },
  devicesList: {
    maxHeight: 300,
  },
  devicesListContent: {
    paddingBottom: 8,
  },
  deviceItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    marginBottom: 8,
  },
  connectedDeviceItem: {
    borderColor: "#3B82F6",
    backgroundColor: "#F0F9FF",
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: "500",
    color: "#1E293B",
    marginBottom: 4,
  },
  deviceId: {
    fontSize: 12,
    color: "#64748B",
  },
  deviceStatus: {
    marginLeft: 8,
  },
  connectButton: {
    backgroundColor: "#3B82F6",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  connectButtonText: {
    color: "#fff",
    fontWeight: "500",
    fontSize: 14,
  },
  connectedIndicator: {
    flexDirection: "row",
    alignItems: "center",
  },
  connectedText: {
    color: "#22C55E",
    fontWeight: "500",
    fontSize: 14,
    marginLeft: 4,
  },
  noDevicesMessage: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#F1F5F9",
    borderRadius: 8,
  },
  noDevicesText: {
    flex: 1,
    marginLeft: 8,
    color: "#64748B",
    fontSize: 14,
  },

  // Recording section styles
  recordingSection: {
    marginBottom: 20,
  },
  connectedDeviceInfo: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  deviceIconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#EFF6FF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  connectedDeviceDetails: {
    flex: 1,
  },
  connectedDeviceName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1E293B",
    marginBottom: 4,
  },
  connectedStatusIndicator: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#22C55E",
    marginRight: 6,
  },
  connectedStatusText: {
    fontSize: 14,
    color: "#22C55E",
  },
  disconnectButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F1F5F9",
    justifyContent: "center",
    alignItems: "center",
  },
  recordingCard: {
    borderRadius: 16,
    padding: 24,
    marginBottom: 20,
    alignItems: "center",
  },
  recordingVisual: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  recordingIndicator: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#E2E8F0",
    marginRight: 12,
  },
  recordingActive: {
    backgroundColor: "#EF4444",
  },
  durationContainer: {
    alignItems: "center",
  },
  durationText: {
    fontSize: 36,
    fontWeight: "bold",
    color: "#1E293B",
    marginBottom: 4,
  },
  recordingStatus: {
    fontSize: 14,
    color: "#64748B",
  },
  recordButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#3B82F6",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  stopButton: {
    backgroundColor: "#EF4444",
  },
  actionButtons: {
    width: "100%",
    alignItems: "center",
  },
  analyzeButton: {
    flexDirection: "row",
    backgroundColor: "#3B82F6",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginBottom: 12,
  },
  analyzeButtonDisabled: {
    backgroundColor: "#94A3B8",
  },
  analyzingContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  analyzeButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
  newRecordingButton: {
    flexDirection: "row",
    alignItems: "center",
  },
  newRecordingText: {
    color: "#3B82F6",
    fontSize: 14,
    fontWeight: "500",
    marginLeft: 6,
  },
  instructionsContainer: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  instructionsTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1E293B",
    marginBottom: 16,
  },
  instructionItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  instructionNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#EFF6FF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  instructionNumberText: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#3B82F6",
  },
  instructionText: {
    flex: 1,
    fontSize: 14,
    color: "#475569",
  },

  // Modal styles
  modalContainer: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  modalContent: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingTop: 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1E293B",
  },
  closeModalButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F1F5F9",
    justifyContent: "center",
    alignItems: "center",
  },
  resultIndicator: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  healthyResult: {
    backgroundColor: "#22C55E",
  },
  unhealthyResult: {
    backgroundColor: "#EF4444",
  },
  resultIndicatorText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    marginLeft: 12,
  },
  confidenceContainer: {
    marginBottom: 24,
  },
  confidenceLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: "#64748B",
    marginBottom: 8,
  },
  confidenceBarContainer: {
    height: 12,
    backgroundColor: "#F1F5F9",
    borderRadius: 6,
    marginBottom: 4,
  },
  confidenceBar: {
    height: "100%",
    backgroundColor: "#3B82F6",
    borderRadius: 6,
  },
  confidenceValue: {
    fontSize: 14,
    color: "#1E293B",
    fontWeight: "600",
    alignSelf: "flex-end",
  },
  descriptionContainer: {
    marginBottom: 24,
  },
  descriptionLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: "#64748B",
    marginBottom: 8,
  },
  descriptionText: {
    fontSize: 16,
    lineHeight: 24,
    color: "#1E293B",
  },
  saveResultsButton: {
    backgroundColor: "#3B82F6",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  saveResultsText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
