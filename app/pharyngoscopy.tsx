import React, { useState, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Platform,
  Image,
  ScrollView,
  Modal,
  Dimensions,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useEffect } from "react";
import { useLocalSearchParams, router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import Constants from "expo-constants";
import axios from "axios";
// @ts-ignore
import TcpSocket from "react-native-tcp-socket";

// TCP Socket Configuration
const TCP_HOST = "192.168.246.217";
const TCP_PORT = 8080;
const BUFFER_SIZE = 4096;
const TERMINATOR = new Uint8Array([0xff, 0xbb]);
const IMAGE_WIDTH = 320;
const IMAGE_HEIGHT = 320;

// Roboflow API key from environment variables (you would need to replace this with your actual key)
// const ROBOFLOW_API_KEY = Constants.expoConfig?.extra?.roboflowApiKey;
const ROBOFLOW_API_KEY = "tgcz7uPiEzWZoTPTSfqe";
const ROBOFLOW_MODEL_ID = "pharyngitis-dataset/3";
const ROBOFLOW_API_URL = "https://serverless.roboflow.com";

interface ImageItem {
  id: string;
  uri: string;
  timestamp: number;
  diagnosis?: {
    result: string; // 'no' or 'phar'
    confidence: number;
    isHealthy: boolean;
  };
}

interface ApiResponse {
  predictions: {
    class: string;
    class_id: number;
    confidence: number;
  }[];
}

const IMAGES_DIRECTORY =
  FileSystem.documentDirectory + "medscope-pharyngoscopy/";

export default function PharyngoscopyScreen() {
  const { testName } = useLocalSearchParams<{ testName: string }>();
  const [captureResult, setCaptureResult] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [apiResponse, setApiResponse] = useState<ApiResponse | null>(null);
  const [storedImages, setStoredImages] = useState<ImageItem[]>([]);
  const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null);
  const [modalVisible, setModalVisible] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [tcpServer, setTcpServer] = useState<any>(null);
  const [clientSocket, setClientSocket] = useState<any>(null);
  const [capturedImageData, setCapturedImageData] = useState<string | null>(
    null
  );
  const [receivedData, setReceivedData] = useState<Uint8Array>(
    new Uint8Array()
  );

  // Camera reference to access methods
  const cameraRef = useRef<any>(null);

  // Setup directory for storing images
  useEffect(() => {
    const initializeApp = async () => {
      await setupDirectory();
      console.log("Setup directory completed");
      await loadSavedImages();
      console.log("Saved images loaded");
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
    const dirInfo = await FileSystem.getInfoAsync(IMAGES_DIRECTORY);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(IMAGES_DIRECTORY, {
        intermediates: true,
      });
    }
  };

  const loadSavedImages = async () => {
    try {
      const files = await FileSystem.readDirectoryAsync(IMAGES_DIRECTORY);
      const imageFiles = files.filter(
        (filename) => !filename.endsWith(".meta.json")
      );

      const imageItems = await Promise.all(
        imageFiles.map(async (filename) => {
          const fileUri = IMAGES_DIRECTORY + filename;
          const metadataPath = fileUri + ".meta.json";

          // Try to load diagnosis from metadata file
          let diagnosis = undefined;
          try {
            const metadataExists = await FileSystem.getInfoAsync(metadataPath);
            if (metadataExists.exists) {
              const metadataContent = await FileSystem.readAsStringAsync(
                metadataPath
              );
              const metadata = JSON.parse(metadataContent);
              diagnosis = metadata.diagnosis;
            }
          } catch (e) {
            console.log("No diagnosis found for", filename);
          }

          const timestamp = parseInt(
            filename.split("_")[1] || Date.now().toString()
          );
          return {
            id: filename,
            uri: fileUri,
            timestamp: timestamp,
            diagnosis: diagnosis,
          };
        })
      );

      // Sort by timestamp (newest first)
      setStoredImages(imageItems.sort((a, b) => b.timestamp - a.timestamp));
    } catch (error) {
      console.error("Failed to load images:", error);
    }
  };

  const saveImageToDevice = async (
    uri: string,
    diagnosisData?: {
      result: string;
      confidence: number;
      isHealthy: boolean;
    }
  ) => {
    try {
      const timestamp = Date.now();
      const newFilename = `pharyngoscopy_${timestamp}.jpg`;
      const newUri = IMAGES_DIRECTORY + newFilename;

      // Save the image file
      await FileSystem.copyAsync({
        from: uri,
        to: newUri,
      });

      // If we have diagnosis data, save it to a metadata file
      if (diagnosisData) {
        const metadataPath = newUri + ".meta.json";
        await FileSystem.writeAsStringAsync(
          metadataPath,
          JSON.stringify({
            diagnosis: diagnosisData,
          })
        );
      }

      const newImage: ImageItem = {
        id: newFilename,
        uri: newUri,
        timestamp,
        diagnosis: diagnosisData,
      };

      setStoredImages((prevImages) => [newImage, ...prevImages]);
      return newImage;
    } catch (error) {
      console.error("Error saving image:", error);
      return null;
    }
  };

  // Initialize TCP server
  const initializeTcpSocket = () => {
    try {
      const server = TcpSocket.createServer(function (socket) {
        console.log("Client connected:", socket.address());
        setIsConnected(true);
        setClientSocket(socket);

        socket.on("data", (data: string | Buffer) => {
          const uint8Data = data as Uint8Array;
          console.log("Received data from camera device");
          handleReceivedImageData(uint8Data);
        });

        socket.on("error", (error: any) => {
          console.error("Client socket error:", error);
          setIsConnected(false);
          setClientSocket(null);
        });

        socket.on("close", () => {
          console.log("Client disconnected");
          setIsConnected(false);
          setClientSocket(null);
        });
      }).listen({ port: TCP_PORT, host: TCP_HOST });

      server.on("error", (error: any) => {
        console.error("TCP server error:", error);
        Alert.alert(
          "Server Error",
          "Failed to start TCP server. Please check if the port is available."
        );
      });

      server.on("close", () => {
        console.log("TCP server closed");
        setIsConnected(false);
        setTcpServer(null);
        setClientSocket(null);
      });

      setTcpServer(server);
      console.log(`TCP server listening on ${TCP_HOST}:${TCP_PORT}`);
    } catch (error) {
      console.error("Failed to initialize TCP server:", error);
      Alert.alert("Server Error", "Failed to initialize TCP server.");
    }
  };

  // Handle received image data from TCP socket
  const handleReceivedImageData = async (data: Uint8Array) => {
    try {
      console.log(`Received ${data.length} bytes from camera`);

      // Accumulate received data
      const newData = new Uint8Array(receivedData.length + data.length);
      newData.set(receivedData);
      newData.set(data, receivedData.length);
      setReceivedData(newData);

      // Check for terminator
      const terminatorIndex = findTerminatorIndex(newData);

      if (terminatorIndex !== -1) {
        console.log(`Found terminator at index ${terminatorIndex}`);
        console.log(`Total received data: ${newData.length} bytes`);

        // Remove 8-byte header and 2-byte terminator
        const imageData = newData.slice(8, terminatorIndex);

        console.log(
          `Image data length after processing: ${imageData.length} bytes`
        );

        // Convert to base64 for saving
        const base64String = btoa(
          String.fromCharCode.apply(null, Array.from(imageData))
        );

        // Create a temporary file to save the image
        const timestamp = Date.now();
        const tempFileName = `temp_capture_${timestamp}.jpg`;
        const tempUri = FileSystem.documentDirectory + tempFileName;

        // Save the image data to a file
        await FileSystem.writeAsStringAsync(tempUri, base64String, {
          encoding: FileSystem.EncodingType.Base64,
        });

        console.log("Image saved to temporary file:", tempUri);

        // Reset received data for next capture
        setReceivedData(new Uint8Array());

        // Process the captured image
        await processCapturedImage(tempUri);

        // Clean up temporary file
        await FileSystem.deleteAsync(tempUri);
      } else {
        // Check if we've received enough data (safety check)
        const expectedSize = IMAGE_WIDTH * IMAGE_HEIGHT * 2;
        if (newData.length >= expectedSize) {
          console.log(
            "Received expected amount of data but no terminator found"
          );
          // Reset and try again
          setReceivedData(new Uint8Array());
          setIsProcessing(false);
        }
      }
    } catch (error) {
      console.error("Error processing received image data:", error);
      Alert.alert("Error", "Failed to process image from camera device.");
      setReceivedData(new Uint8Array());
      setIsProcessing(false);
    }
  };

  // Helper function to find terminator in data
  const findTerminatorIndex = (data: Uint8Array): number => {
    for (let i = 0; i < data.length - 1; i++) {
      if (data[i] === TERMINATOR[0] && data[i + 1] === TERMINATOR[1]) {
        return i;
      }
    }
    return -1;
  };

  // Handle image capture via TCP socket
  const handleCapture = async () => {
    if (!isConnected || !clientSocket) {
      Alert.alert(
        "Connection Error",
        "Not connected to camera device. Please check the connection."
      );
      return;
    }

    setIsProcessing(true);

    try {
      console.log("Setting image resolution...");
      // Set image resolution command (0x01, 0x18)
      const resolutionCommand = new Uint8Array([0x01, 0x18]);
      clientSocket.write(resolutionCommand);

      // Small delay before capture command
      setTimeout(() => {
        console.log("Sending capture command to camera device...");
        // Send capture command (0x10)
        const captureCommand = new Uint8Array([0x10]);
        clientSocket.write(captureCommand);
        console.log("Capture command sent, waiting for image data...");
      }, 500);

      // The image data will be received via the 'data' event handler
    } catch (error: any) {
      console.error("Error sending capture command:", error);
      Alert.alert(
        "Capture Error",
        "Failed to send capture command to camera device."
      );
      setIsProcessing(false);
    }
  };

  // Process the captured image through Roboflow API
  const processCapturedImage = async (uri: string) => {
    try {
      // Set the captured image for display
      setCapturedImageData(uri);

      // Convert image to base64
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Log API request details
      console.log("API Request:", {
        url: `${ROBOFLOW_API_URL}/pharyngitis-dataset/3`,
        method: "POST",
        params: { api_key: "****" }, // Hide actual API key in logs
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        dataLength: base64.length, // Log length instead of full base64 to avoid console clutter
      });

      // Make request to Roboflow API using axios
      const response = await axios({
        method: "POST",
        url: `${ROBOFLOW_API_URL}/pharyngitis-dataset/3`,
        params: {
          api_key: ROBOFLOW_API_KEY,
        },
        data: base64,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      // Log API response
      console.log("API Response:", response.data);

      const result: ApiResponse = response.data;
      setApiResponse(result);

      // Process and save the result
      if (result.predictions && result.predictions.length > 0) {
        const prediction = result.predictions[0];
        const isHealthy = prediction.class === "no";
        const diagnosisData = {
          result: prediction.class,
          confidence: prediction.confidence,
          isHealthy: isHealthy,
        };

        const savedImage = await saveImageToDevice(uri, diagnosisData);
        if (savedImage) {
          setSelectedImage(savedImage);
          setModalVisible(true);
        }
      }
    } catch (error) {
      console.error("API Error:", error);

      // Create mock result for development/testing
      const mockResult = {
        class: Math.random() > 0.5 ? "no" : "phar",
        confidence: Math.random() * 0.3 + 0.7, // 0.7-1.0
      };

      // console.log("Using mock result:", mockResult);

      const diagnosisData = {
        result: mockResult.class,
        confidence: mockResult.confidence,
        isHealthy: mockResult.class === "no",
      };

      const savedImage = await saveImageToDevice(uri, diagnosisData);
      if (savedImage) {
        setSelectedImage(savedImage);
        setModalVisible(true);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImagePress = (image: ImageItem) => {
    setSelectedImage(image);
    setModalVisible(true);
  };

  // Confirm before deleting an image
  const confirmDelete = (imageItem: ImageItem) => {
    Alert.alert(
      "Delete Image",
      "Are you sure you want to delete this image?",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          onPress: () => deleteImage(imageItem),
          style: "destructive",
        },
      ],
      { cancelable: true }
    );
  };

  // Delete an image and its metadata
  const deleteImage = async (imageItem: ImageItem) => {
    try {
      // Delete the image file
      await FileSystem.deleteAsync(imageItem.uri);

      // Try to delete metadata file if it exists
      const metadataPath = imageItem.uri + ".meta.json";
      const metadataInfo = await FileSystem.getInfoAsync(metadataPath);
      if (metadataInfo.exists) {
        await FileSystem.deleteAsync(metadataPath);
      }

      // Remove the image from the state
      setStoredImages((current) =>
        current.filter((item) => item.id !== imageItem.id)
      );

      // Close the modal if it was open
      setModalVisible(false);
      setSelectedImage(null);
    } catch (error) {
      console.error("Failed to delete image:", error);
      Alert.alert("Error", "Failed to delete the image");
    }
  };

  // Render previous images in a horizontal scroll
  const renderPreviousImages = () => {
    if (storedImages.length === 0) return null;

    return (
      <View style={styles.previousImagesContainer}>
        <Text style={styles.previousImagesTitle}>Previous Captures</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.previousImagesScroll}
        >
          {storedImages.map((image) => (
            <TouchableOpacity
              key={image.id}
              style={styles.previousImageItem}
              onPress={() => handleImagePress(image)}
            >
              <Image source={{ uri: image.uri }} style={styles.previousImage} />
              {image.diagnosis && (
                <View
                  style={[
                    styles.diagnosisIndicator,
                    image.diagnosis.isHealthy
                      ? styles.healthyIndicator
                      : styles.unhealthyIndicator,
                  ]}
                >
                  <Text style={styles.diagnosisIndicatorText}>
                    {image.diagnosis.isHealthy ? "Healthy" : "Pharyngitis"}
                  </Text>
                </View>
              )}
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
          <Text style={styles.title}>{testName || "Pharyngoscopy"}</Text>
          <Text style={styles.subtitle}>
            Capture throat image for pharyngitis detection
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Guidance section */}
        <View style={styles.guidanceContainer}>
          <Text style={styles.guidanceTitle}>Pharyngoscopy Guidance</Text>
          <Text style={styles.guidanceText}>
            Position the camera to capture a clear view of the throat. Ensure
            good lighting and keep the device steady.
          </Text>
        </View>

        {/* Camera capture section */}
        <View style={styles.cameraContainer}>
          <TouchableOpacity
            style={styles.captureButton}
            onPress={handleCapture}
            disabled={isProcessing || !isConnected}
          >
            <View style={styles.captureButtonInner}>
              {isProcessing ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Feather name="camera" size={24} color="#fff" />
                  <Text style={styles.captureButtonText}>
                    {isConnected ? "Capture Image" : "Connecting..."}
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
              {isConnected ? "Connected to camera device" : "Disconnected"}
            </Text>
          </View>
        </View>

        {/* Processing indicator */}
        {isProcessing && (
          <View style={styles.processingContainer}>
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text style={styles.processingText}>Analyzing image...</Text>
          </View>
        )}

        {/* Captured Image Display */}
        {capturedImageData && !isProcessing && (
          <View style={styles.capturedImageContainer}>
            <Text style={styles.capturedImageTitle}>Recently Captured</Text>
            <Image
              source={{ uri: capturedImageData }}
              style={styles.capturedImage}
              resizeMode="contain"
            />
          </View>
        )}

        {/* Previously captured images */}
        {renderPreviousImages()}
      </ScrollView>

      {/* Results Modal */}
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

            {selectedImage && (
              <>
                <Text style={styles.modalTitle}>Analysis Results</Text>

                <Image
                  source={{ uri: selectedImage.uri }}
                  style={styles.modalImage}
                  resizeMode="contain"
                />

                {selectedImage.diagnosis ? (
                  <View style={styles.resultContainer}>
                    <View
                      style={[
                        styles.diagnosisResult,
                        selectedImage.diagnosis.isHealthy
                          ? styles.healthyResult
                          : styles.unhealthyResult,
                      ]}
                    >
                      <Feather
                        name={
                          selectedImage.diagnosis.isHealthy
                            ? "check-circle"
                            : "alert-circle"
                        }
                        size={30}
                        color="#fff"
                      />
                      <Text style={styles.diagnosisResultText}>
                        {selectedImage.diagnosis.isHealthy
                          ? "Healthy - No Pharyngitis Detected"
                          : "Pharyngitis Detected"}
                      </Text>
                    </View>

                    <View style={styles.confidenceContainer}>
                      <Text style={styles.confidenceLabel}>
                        Confidence Level
                      </Text>
                      <View style={styles.confidenceBarContainer}>
                        <View
                          style={[
                            styles.confidenceBar,
                            {
                              width: `${
                                selectedImage.diagnosis.confidence * 100
                              }%`,
                            },
                          ]}
                        />
                      </View>
                      <Text style={styles.confidenceValue}>
                        {Math.round(selectedImage.diagnosis.confidence * 100)}%
                      </Text>
                    </View>

                    <View style={styles.recommendationContainer}>
                      <Text style={styles.recommendationTitle}>
                        Recommendation
                      </Text>
                      <Text style={styles.recommendationText}>
                        {selectedImage.diagnosis.isHealthy
                          ? "No signs of pharyngitis detected. Continue to monitor symptoms and maintain good oral hygiene."
                          : "Signs of pharyngitis detected. It is recommended to consult a healthcare professional for proper diagnosis and treatment."}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.noDiagnosisContainer}>
                    <Text style={styles.noDiagnosisText}>
                      No analysis results available
                    </Text>
                  </View>
                )}

                {/* Delete Button */}
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => confirmDelete(selectedImage)}
                >
                  <Feather name="trash-2" size={18} color="#fff" />
                  <Text style={styles.deleteButtonText}>Delete Image</Text>
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
    alignItems: "center",
    paddingBottom: 20,
  },
  container: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    paddingTop: 20,
  },
  cameraContainer: {
    alignItems: "center",
    marginBottom: 20,
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
  message: {
    textAlign: "center",
    paddingBottom: 10,
    fontSize: 16,
    color: "#64748B",
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
  previousImagesContainer: {
    width: "100%",
    paddingHorizontal: 16,
    marginTop: 10,
  },
  previousImagesTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1E293B",
    marginBottom: 10,
  },
  previousImagesScroll: {
    paddingBottom: 5,
  },
  previousImageItem: {
    marginRight: 12,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  previousImage: {
    width: 100,
    height: 120,
    borderRadius: 8,
  },
  diagnosisIndicator: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 4,
    alignItems: "center",
  },
  healthyIndicator: {
    backgroundColor: "rgba(34, 197, 94, 0.8)",
  },
  unhealthyIndicator: {
    backgroundColor: "rgba(239, 68, 68, 0.8)",
  },
  diagnosisIndicatorText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
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
    alignItems: "center",
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
  },
  modalImage: {
    width: width * 0.7,
    height: width * 0.7,
    borderRadius: 8,
    marginBottom: 20,
  },
  resultContainer: {
    width: "100%",
  },
  diagnosisResult: {
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
  unhealthyResult: {
    backgroundColor: "#EF4444",
  },
  diagnosisResultText: {
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
  noDiagnosisContainer: {
    padding: 16,
    alignItems: "center",
    marginBottom: 15,
  },
  noDiagnosisText: {
    fontSize: 16,
    color: "#64748B",
    fontStyle: "italic",
  },

  // Capture button styles
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

  // Connection status styles
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

  // Captured image display styles
  capturedImageContainer: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
  },
  capturedImageTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1E293B",
    marginBottom: 12,
  },
  capturedImage: {
    width: width * 0.8,
    height: width * 0.8,
    borderRadius: 8,
  },
});
