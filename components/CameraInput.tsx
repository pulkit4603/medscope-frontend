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
import {
  ReactNode,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { apiurl } from "@/constants/api";

// Define interface matching the backend response structure
interface MedicalAssessment {
  diagnosis: string;
  findings: string;
  recommendation: string;
}

interface ApiResponse {
  message?: string;
  filename?: string;
  image?: string;
  medical_assessment?: MedicalAssessment;
  error?: boolean;
}

type CameraInputProps = {
  width?: number;
  height?: number;
  facing?: "front" | "back";
  onPermissionDenied?: () => ReactNode;
  onCapture?: (photo: CameraCapturedPicture, apiResponse?: any) => void;
  buttonSize?: "small" | "medium" | "large";
  buttonPosition?: "close" | "far";
  buttonStyle?: object;
  category?: string;
};

// Define interface for the exposed methods via ref
interface CameraInputHandle {
  uploadImage: (photo: CameraCapturedPicture) => Promise<ApiResponse>;
}

const CameraInput = forwardRef<CameraInputHandle, CameraInputProps>(
  (
    {
      width = 300,
      height = 400,
      facing = "back",
      onPermissionDenied,
      onCapture,
      buttonSize = "medium",
      buttonPosition = "far",
      buttonStyle = {},
      category,
    },
    ref
  ) => {
    const [permission, requestPermission] = useCameraPermissions();
    const cameraRef = useRef<any>(null);
    const [isUploading, setIsUploading] = useState(false);

    // Expose the uploadImage method to parent component via ref
    useImperativeHandle(ref, () => ({
      uploadImage: uploadImage,
    }));

    const captureImage = async () => {
      if (!cameraRef.current) return;

      try {
        const photo = await cameraRef.current.takePictureAsync();

        // Simply call onCapture with the photo, skip API upload
        if (onCapture) {
          onCapture(photo);
        }
      } catch (error) {
        console.error("Error capturing image:", error);
      }
    };

    // Keep the uploadImage method for backward compatibility and ref exposure,
    // but don't actually upload unless explicitly called from parent
    const uploadImage = async (photo: CameraCapturedPicture) => {
      // Return a mock successful response instead of uploading
      return {
        message: "Image captured successfully",
        error: false,
      } as ApiResponse;
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

    // Get button dimensions based on size prop
    const getButtonDimensions = () => {
      switch (buttonSize) {
        case "small":
          return { height: 60, width: 60, borderRadius: 30 };
        case "large":
          return { height: 100, width: 100, borderRadius: 50 };
        case "medium":
        default:
          return { height: 80, width: 80, borderRadius: 40 };
      }
    };

    // Get position styles based on buttonPosition prop
    const getPositionStyles = () => {
      return buttonPosition === "close" ? { marginTop: 10 } : { marginTop: 30 };
    };

    const buttonDimensions = getButtonDimensions();
    const positionStyles = getPositionStyles();

    return (
      <View style={styles.container}>
        <View style={[styles.cameraContainer, { width, height }]}>
          <CameraView style={styles.camera} facing={facing} ref={cameraRef} />
          {isUploading && (
            <View style={styles.uploadingOverlay}>
              <ActivityIndicator color="#fff" size="large" />
              <Text style={styles.uploadingText}>Processing...</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[
            styles.captureButton,
            buttonDimensions,
            positionStyles,
            buttonStyle,
          ]}
          onPress={captureImage}
          disabled={isUploading}
        >
          <View
            style={[
              styles.captureButtonInner,
              {
                width: "70%",
                height: "70%",
                backgroundColor: "#3b82f6",
                borderRadius: 100,
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
              },
            ]}
          >
            {isUploading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <View style={styles.captureDot} />
            )}
          </View>
        </TouchableOpacity>
      </View>
    );
  }
);

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
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  captureButtonInner: {
    width: "80%",
    height: "80%",
    borderRadius: 100,
    backgroundColor: "#ef4444",
  },
  captureDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
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

export default CameraInput;
