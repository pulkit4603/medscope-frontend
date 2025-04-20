import {
  StyleSheet,
  Text,
  View,
  Button,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Platform,
  Image,
} from "react-native";
import CameraInput from "../components/CameraInput";
import { useState } from "react";
import { useLocalSearchParams, router } from "expo-router";
import { Feather } from "@expo/vector-icons";

interface ApiResponse {
  message?: string;
  image?: string;
  filename?: string;
}

export default function ImagingScreen() {
  const [captureResult, setCaptureResult] = useState<any>(null);
  const [apiResponse, setApiResponse] = useState<ApiResponse | null>(null);
  const { testName } = useLocalSearchParams<{ testName: string }>();

  // Custom permission denied handler
  const handlePermissionDenied = () => (
    <View style={styles.container}>
      <Text style={styles.message}>
        Camera access is required for this feature
      </Text>
      <Button title="Request Permission" onPress={() => {}} />
    </View>
  );

  const handleCapture = (result: any, response: any) => {
    setCaptureResult(result);
    setApiResponse(response);
    console.log("Image captured and uploaded:", result);
    console.log("API response:", response);
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
          <Text style={styles.title}>{testName || "Imaging"}</Text>
          <Text style={styles.subtitle}>Capture image for analysis</Text>
        </View>
      </View>

      <View style={styles.container}>
        <View style={styles.cameraContainer}>
          <CameraInput
            width={300}
            height={400}
            facing="back"
            onPermissionDenied={handlePermissionDenied}
            onCapture={handleCapture}
            buttonSize="small"
            buttonPosition="close"
            buttonStyle={{
              height: 50,
              width: 50,
              borderRadius: 25,
              marginTop: 5,
              backgroundColor: "rgba(255, 255, 255, 0.85)",
              borderWidth: 1,
              borderColor: "#e0e0e0",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.2,
              shadowRadius: 4,
              elevation: 3,
            }}
          />
        </View>
        
        {(apiResponse || captureResult) && (
          <View style={styles.resultContainer}>
            {apiResponse && (
              <Text style={styles.captureStatus}>
                {apiResponse.message || "Image processed successfully"}
              </Text>
            )}
            
            <View style={styles.imagePreviewContainer}>
              {apiResponse && apiResponse.image ? (
                <Image
                  source={{ uri: `data:image/jpeg;base64,${apiResponse.image}` }}
                  style={styles.previewImage}
                  resizeMode="contain"
                />
              ) : captureResult ? (
                <Image
                  source={{ uri: captureResult.uri }}
                  style={styles.previewImage}
                  resizeMode="contain"
                />
              ) : null}
              
              {apiResponse && (
                <Text style={styles.filenameText}>
                  {apiResponse.filename || "Processed image"}
                </Text>
              )}
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight || 25 : 0,
  },
  container: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    paddingTop: 20,
  },
  cameraContainer: {
    alignItems: "center",
    marginTop: 0,
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
  },
  captureStatus: {
    marginTop: 15,
    marginBottom: 10,
    color: "green",
    fontWeight: "bold",
    textAlign: "center",
  },
  resultContainer: {
    marginTop: 10,
    alignItems: "center",
    width: "100%",
  },
  imagePreviewContainer: {
    alignItems: "center",
    padding: 10,
    backgroundColor: "#fff",
    borderRadius: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
    width: 300,
  },
  previewImage: {
    width: 280,
    height: 200,
    borderRadius: 8,
  },
  filenameText: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: "500",
    color: "#334155",
  },
});
