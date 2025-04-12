import {
  CameraView,
  useCameraPermissions,
  CameraCapturedPicture,
} from "expo-camera";
import {
  StyleSheet,
  Text,
  View,
  Button,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { ReactNode, useRef, useState } from "react";
import { apiurl } from "@/constants/api";

type CameraInputProps = {
  width?: number;
  height?: number;
  facing?: "front" | "back";
  onPermissionDenied?: () => ReactNode;
  onCapture?: (result: any) => void;
};

export default function CameraInput({
  width = 300,
  height = 400,
  facing = "back",
  onPermissionDenied,
  onCapture,
}: CameraInputProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<any>(null);
  const [isUploading, setIsUploading] = useState(false);

  const captureImage = async () => {
    if (!cameraRef.current) return;

    try {
      setIsUploading(true);
      const photo = await cameraRef.current.takePictureAsync();
      await uploadImage(photo);
      if (onCapture) {
        onCapture(photo);
      }
    } catch (error) {
      console.error("Error capturing image:", error);
    } finally {
      setIsUploading(false);
    }
  };

  const uploadImage = async (photo: CameraCapturedPicture) => {
    try {
      // Create form data for the upload
      const formData = new FormData();
      formData.append("image", {
        uri: photo.uri,
        type: "image/jpeg",
        name: "upload.jpg",
      } as any);

      // Send to API
      const response = await fetch(`${apiurl}/upload-image`, {
        method: "POST",
        body: formData,
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      const result = await response.json();
      console.log("Upload successful:", result);
      return result;
    } catch (error) {
      console.error("Error uploading image:", error);
      throw error;
    }
  };

  if (!permission) {
    // Camera permissions are still loading.
    return <View />;
  }

  if (!permission.granted) {
    // Camera permissions are not granted yet.
    if (onPermissionDenied) {
      return <>{onPermissionDenied()}</>;
    }
    return (
      <View style={styles.container}>
        <Text style={styles.message}>
          We need your permission to show the camera
        </Text>
        <Button onPress={requestPermission} title="grant permission" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.cameraContainer, { width, height }]}>
        <CameraView style={styles.camera} facing={facing} ref={cameraRef} />
        {isUploading && (
          <View style={styles.uploadingOverlay}>
            <ActivityIndicator color="#fff" size="large" />
            <Text style={styles.uploadingText}>Uploading...</Text>
          </View>
        )}
      </View>

      <TouchableOpacity
        style={styles.captureButton}
        onPress={captureImage}
        disabled={isUploading}
      >
        <View style={styles.captureButtonInner} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: "center",
    alignItems: "center",
  },
  message: {
    textAlign: "center",
    paddingBottom: 10,
  },
  cameraContainer: {
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#ddd",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    position: "relative",
  },
  camera: {
    width: "100%",
    height: "100%",
  },
  captureButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 20,
    borderWidth: 3,
    borderColor: "#fff",
  },
  captureButtonInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#fff",
  },
  uploadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  uploadingText: {
    color: "#fff",
    marginTop: 10,
    fontSize: 16,
  },
});
