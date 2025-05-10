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
  Dimensions,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Svg, { Path, Line } from "react-native-svg";

import { tcpServer } from "../services/TcpService";

// Interfaces
interface ConnectionStatus {
  isRunning: boolean;
  address: string | null;
  port: number;
  clients: number;
}

interface EcgData {
  timestamp: number;
  data: number[];
}

// Screen width for scaling the graph
const { width } = Dimensions.get("window");
const GRAPH_WIDTH = width - 40;
const GRAPH_HEIGHT = 200;
const MAX_DATA_POINTS = 200; // Number of data points to display at once
const DATA_SCALE = 0.1; // Scale factor for the ECG data

export default function EcgScreen() {
  const { testName } = useLocalSearchParams<{ testName: string }>();
  
  // State variables
  const [serverStatus, setServerStatus] = useState<ConnectionStatus>({
    isRunning: false,
    address: null,
    port: 8080,
    clients: 0
  });
  const [isStartingServer, setIsStartingServer] = useState(false);
  const [ecgDataPoints, setEcgDataPoints] = useState<number[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  
  // Refs
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const recordedDataRef = useRef<EcgData[]>([]);
  
  // Effect to handle server connection and data
  useEffect(() => {
    // Set up event listeners for the TCP server
    tcpServer.on('connection', (client) => {
      console.log('Client connected:', client);
      setServerStatus(prev => ({ ...prev, clients: prev.clients + 1 }));
      
      // Send the initial command (integer 1) to request ECG data
      if (isRecording) {
        tcpServer.sendToClient(client.id, 1);
      }
      
      // Provide haptic feedback on connection
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });
    
    tcpServer.on('data', (data) => {
      if (data.dataType === 'ecg' && isRecording) {
        // Add new data points
        setEcgDataPoints(currentData => {
          const newData = [...currentData, ...data.data];
          // Keep only the most recent MAX_DATA_POINTS
          return newData.slice(-MAX_DATA_POINTS);
        });
        
        // Store the data for potential analysis
        recordedDataRef.current.push({
          timestamp: data.timestamp,
          data: data.data
        });
      }
    });
    
    tcpServer.on('disconnection', (client) => {
      console.log('Client disconnected:', client);
      setServerStatus(prev => ({ ...prev, clients: Math.max(0, prev.clients - 1) }));
      
      // Provide haptic feedback on disconnection
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    });
    
    tcpServer.on('error', (error) => {
      console.error('TCP Server error:', error);
      Alert.alert('Server Error', 'An error occurred with the TCP server.');
    });
    
    // Cleanup event listeners when the component unmounts
    return () => {
      tcpServer.off('connection', () => {});
      tcpServer.off('data', () => {});
      tcpServer.off('disconnection', () => {});
      tcpServer.off('error', () => {});
      
      // Stop the server when component unmounts
      if (serverStatus.isRunning) {
        tcpServer.stop();
      }
      
      // Clear any timers
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRecording]);
  
  // Start the TCP server
  const startServer = async () => {
    setIsStartingServer(true);
    try {
      const serverIp = await tcpServer.start();
      if (serverIp) {
        const status = tcpServer.getStatus();
        setServerStatus(status);
        
        // Provide haptic feedback
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert('Server Error', 'Failed to start TCP server');
      }
    } catch (error) {
      console.error('Failed to start server:', error);
      Alert.alert('Server Error', 'Could not start the TCP server');
    } finally {
      setIsStartingServer(false);
    }
  };
  
  // Stop the TCP server
  const stopServer = () => {
    // First stop recording if it's in progress
    if (isRecording) {
      stopRecording();
    }
    
    tcpServer.stop();
    setServerStatus({
      isRunning: false,
      address: null,
      port: 8080,
      clients: 0
    });
    
    // Provide haptic feedback
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  };
  
  // Start recording ECG data
  const startRecording = () => {
    if (!serverStatus.isRunning) {
      Alert.alert('Server Not Running', 'Please start the server first');
      return;
    }
    
    // Clear previous recording data
    recordedDataRef.current = [];
    setEcgDataPoints([]);
    
    // Set recording state and start time
    setIsRecording(true);
    const startTime = Date.now();
    setRecordingStartTime(startTime);
    
    // Start a timer to track elapsed time
    timerRef.current = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    
    // Send command to all clients to start sending ECG data
    if (serverStatus.clients > 0) {
      tcpServer.sendToAll(1);
    }
    
    // Provide haptic feedback
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };
  
  // Stop recording ECG data
  const stopRecording = () => {
    setIsRecording(false);
    
    // Stop the timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    // Send command to stop sending ECG data (0 = stop)
    if (serverStatus.clients > 0) {
      tcpServer.sendToAll(0);
    }
    
    // Provide haptic feedback
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    
    // Here you could save or analyze the recorded data
    console.log(`Recorded ${recordedDataRef.current.length} ECG data chunks`);
  };
  
  // Format elapsed time as mm:ss
  const formatElapsedTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };
  
  // Generate the ECG graph path from the data
  const generateEcgPath = () => {
    if (ecgDataPoints.length === 0) return '';
    
    const pointSpacing = GRAPH_WIDTH / Math.min(MAX_DATA_POINTS, ecgDataPoints.length);
    let path = `M 0 ${GRAPH_HEIGHT/2}`;
    
    ecgDataPoints.forEach((point, index) => {
      // Scale the data to fit within the graph height
      // 512 is the midpoint of a 10-bit ADC (0-1023)
      const scaledValue = GRAPH_HEIGHT/2 - ((point - 512) * GRAPH_HEIGHT/1023 * DATA_SCALE);
      path += ` L ${index * pointSpacing} ${scaledValue}`;
    });
    
    return path;
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
          <Text style={styles.title}>{testName || "ECG"}</Text>
          <Text style={styles.subtitle}>
            {serverStatus.isRunning 
              ? `Server: ${serverStatus.address}:${serverStatus.port} (${serverStatus.clients} client${serverStatus.clients !== 1 ? 's' : ''})`
              : 'Start server to connect with STM32'}
          </Text>
        </View>
      </View>
      
      <ScrollView 
        style={styles.container} 
        contentContainerStyle={styles.contentContainer}
      >
        {/* Server Control Section */}
        <View style={styles.serverSection}>
          <LinearGradient
            colors={serverStatus.isRunning ? ["#10B981", "#059669"] : ["#3B82F6", "#2563EB"]}
            style={styles.serverCard}
          >
            <Feather 
              name={serverStatus.isRunning ? "server" : "wifi"} 
              size={40} 
              color="#fff" 
            />
            <Text style={styles.serverCardTitle}>
              {serverStatus.isRunning ? "Server Running" : "Start TCP Server"}
            </Text>
            <Text style={styles.serverCardText}>
              {serverStatus.isRunning 
                ? `Your device is acting as a TCP server on port ${serverStatus.port}`
                : "Start a TCP server to receive ECG data from connected devices"}
            </Text>
            
            <TouchableOpacity
              style={[
                styles.serverButton,
                serverStatus.isRunning ? styles.stopServerButton : styles.startServerButton
              ]}
              onPress={serverStatus.isRunning ? stopServer : startServer}
              disabled={isStartingServer}
            >
              {isStartingServer ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.serverButtonText}>
                  {serverStatus.isRunning ? "Stop Server" : "Start Server"}
                </Text>
              )}
            </TouchableOpacity>
          </LinearGradient>
        </View>
        
        {/* ECG Graph Section */}
        <View style={styles.ecgSection}>
          <View style={styles.ecgHeader}>
            <View>
              <Text style={styles.ecgTitle}>ECG Waveform</Text>
              {isRecording && (
                <View style={styles.recordingIndicator}>
                  <View style={styles.recordingDot} />
                  <Text style={styles.recordingText}>
                    Recording: {formatElapsedTime(elapsedTime)}
                  </Text>
                </View>
              )}
            </View>
            
            <TouchableOpacity
              style={[
                styles.recordButton,
                isRecording ? styles.stopRecordButton : styles.startRecordButton
              ]}
              onPress={isRecording ? stopRecording : startRecording}
              disabled={!serverStatus.isRunning}
            >
              <Feather 
                name={isRecording ? "square" : "activity"} 
                size={18} 
                color="#fff" 
              />
              <Text style={styles.recordButtonText}>
                {isRecording ? "Stop" : "Record"}
              </Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.graphContainer}>
            {/* ECG Grid */}
            <Svg width={GRAPH_WIDTH} height={GRAPH_HEIGHT} style={styles.ecgGrid}>
              {/* Vertical grid lines */}
              {Array.from({ length: 20 }, (_, i) => (
                <Line
                  key={`vline-${i}`}
                  x1={i * (GRAPH_WIDTH / 20)}
                  y1="0"
                  x2={i * (GRAPH_WIDTH / 20)}
                  y2={GRAPH_HEIGHT}
                  stroke="#E2E8F0"
                  strokeWidth="1"
                />
              ))}
              
              {/* Horizontal grid lines */}
              {Array.from({ length: 10 }, (_, i) => (
                <Line
                  key={`hline-${i}`}
                  x1="0"
                  y1={i * (GRAPH_HEIGHT / 10)}
                  x2={GRAPH_WIDTH}
                  y2={i * (GRAPH_HEIGHT / 10)}
                  stroke="#E2E8F0"
                  strokeWidth="1"
                />
              ))}
              
              {/* Highlight the center line */}
              <Line
                x1="0"
                y1={GRAPH_HEIGHT / 2}
                x2={GRAPH_WIDTH}
                y2={GRAPH_HEIGHT / 2}
                stroke="#CBD5E1"
                strokeWidth="2"
              />
            </Svg>
            
            {/* ECG Data Path */}
            <Svg width={GRAPH_WIDTH} height={GRAPH_HEIGHT} style={styles.ecgData}>
              <Path
                d={generateEcgPath()}
                fill="none"
                stroke="#EF4444"
                strokeWidth="2"
              />
            </Svg>
            
            {/* Show a message when there's no data */}
            {ecgDataPoints.length === 0 && (
              <View style={styles.noDataOverlay}>
                <Feather name="heart" size={40} color="#CBD5E1" />
                <Text style={styles.noDataText}>
                  {serverStatus.isRunning 
                    ? "Start recording to see ECG data" 
                    : "Start the server and connect your device"}
                </Text>
              </View>
            )}
          </View>
        </View>
        
        {/* Instructions Section */}
        <View style={styles.instructionsContainer}>
          <Text style={styles.instructionsTitle}>How to use:</Text>
          <View style={styles.instructionItem}>
            <View style={styles.instructionNumber}>
              <Text style={styles.instructionNumberText}>1</Text>
            </View>
            <Text style={styles.instructionText}>
              Start the TCP server to allow your STM32 device to connect
            </Text>
          </View>
          <View style={styles.instructionItem}>
            <View style={styles.instructionNumber}>
              <Text style={styles.instructionNumberText}>2</Text>
            </View>
            <Text style={styles.instructionText}>
              Configure your STM32 device to connect to this server at {serverStatus.address || "your.ip.address"}:{serverStatus.port}
            </Text>
          </View>
          <View style={styles.instructionItem}>
            <View style={styles.instructionNumber}>
              <Text style={styles.instructionNumberText}>3</Text>
            </View>
            <Text style={styles.instructionText}>
              Press "Record" to start receiving and displaying ECG data
            </Text>
          </View>
        </View>
      </ScrollView>
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
    fontSize: 14,
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
  
  // Server Section Styles
  serverSection: {
    marginBottom: 20,
  },
  serverCard: {
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
  },
  serverCardTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "bold",
    marginTop: 16,
    marginBottom: 8,
  },
  serverCardText: {
    color: "#fff",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 20,
    opacity: 0.9,
  },
  serverButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 150,
  },
  startServerButton: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  stopServerButton: {
    backgroundColor: "#F43F5E",
  },
  serverButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  
  // ECG Section Styles
  ecgSection: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  ecgHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  ecgTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1E293B",
  },
  recordingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#EF4444",
    marginRight: 6,
  },
  recordingText: {
    color: "#EF4444",
    fontSize: 14,
    fontWeight: "500",
  },
  recordButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  startRecordButton: {
    backgroundColor: "#3B82F6",
  },
  stopRecordButton: {
    backgroundColor: "#EF4444",
  },
  recordButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 6,
  },
  graphContainer: {
    width: GRAPH_WIDTH,
    height: GRAPH_HEIGHT,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 8,
    overflow: "hidden",
    position: "relative",
  },
  ecgGrid: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  ecgData: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  noDataOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.7)",
  },
  noDataText: {
    marginTop: 12,
    fontSize: 14,
    color: "#64748B",
    textAlign: "center",
    paddingHorizontal: 20,
  },
  
  // Instructions Section Styles
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
});