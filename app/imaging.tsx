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
  ScrollView,
  Modal,
  Dimensions,
  FlatList,
} from "react-native";
import CameraInput from "../components/CameraInput";
import { useEffect, useState } from "react";
import { useLocalSearchParams, router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";

interface ApiResponse {
  message?: string;
  image?: string;
  filename?: string;
  path?: string;
}

interface ImageItem {
  id: string;
  uri: string;
  filename: string;
  timestamp: number;
}

const IMAGES_DIRECTORY = FileSystem.documentDirectory + "medscope-images/";

export default function ImagingScreen() {
  const [captureResult, setCaptureResult] = useState<any>(null);
  const [apiResponse, setApiResponse] = useState<ApiResponse | null>(null);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null);
  const [modalVisible, setModalVisible] = useState<boolean>(false);
  const { testName } = useLocalSearchParams<{ testName: string }>();

  // Setup directory for storing images
  useEffect(() => {
    setupDirectory();
    loadSavedImages();
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
      const imageItems = await Promise.all(
        files.map(async (filename) => {
          const fileUri = IMAGES_DIRECTORY + filename;
          const fileInfo = await FileSystem.getInfoAsync(fileUri);
          const metadata = filename.split("_");
          return {
            id: filename,
            uri: fileUri,
            filename: metadata[0] || "unknown",
            timestamp: parseInt(metadata[1] || Date.now().toString()),
          };
        })
      );

      // Sort by timestamp (newest first)
      setImages(imageItems.sort((a, b) => b.timestamp - a.timestamp));
    } catch (error) {
      console.error("Failed to load images:", error);
    }
  };

  const saveImageToDevice = async (uri: string, filename: string) => {
    try {
      const timestamp = Date.now();
      const newFilename = `${filename || "image"}_${timestamp}.jpg`;
      const newUri = IMAGES_DIRECTORY + newFilename;

      await FileSystem.copyAsync({
        from: uri,
        to: newUri,
      });

      const newImage: ImageItem = {
        id: newFilename,
        uri: newUri,
        filename: filename || "image",
        timestamp,
      };

      setImages((prevImages) => [newImage, ...prevImages]);
      return newImage;
    } catch (error) {
      console.error("Error saving image:", error);
      return null;
    }
  };

  // Custom permission denied handler
  const handlePermissionDenied = () => (
    <View style={styles.container}>
      <Text style={styles.message}>
        Camera access is required for this feature
      </Text>
      <Button title="Request Permission" onPress={() => {}} />
    </View>
  );

  const handleCapture = async (result: any, response: any) => {
    setCaptureResult(result);
    setApiResponse(response);
    console.log("Image captured and uploaded:", result);
    console.log("API response:", response);

    // Save the captured image
    if (result && result.uri) {
      await saveImageToDevice(result.uri, response?.filename || "captured");
    }
  };

  const handleImagePress = (item: ImageItem) => {
    setSelectedImage(item);
    setModalVisible(true);
  };

  const renderImageItem = ({ item }: { item: ImageItem }) => (
    <TouchableOpacity
      style={styles.gridItem}
      onPress={() => handleImagePress(item)}
    >
      <Image
        source={{ uri: item.uri }}
        style={styles.gridImage}
        resizeMode="cover"
      />
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
          <Text style={styles.title}>{testName || "Imaging"}</Text>
          <Text style={styles.subtitle}>Capture image for analysis</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
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

        {apiResponse && (
          <View style={styles.statusContainer}>
            <Text style={styles.captureStatus}>
              {apiResponse.message || "Image processed successfully"}
            </Text>
          </View>
        )}

        {images.length > 0 && (
          <View style={styles.galleryContainer}>
            <Text style={styles.galleryTitle}>Image Gallery</Text>
            <FlatList
              data={images}
              renderItem={renderImageItem}
              keyExtractor={(item) => item.id}
              numColumns={3}
              columnWrapperStyle={styles.gridRow}
              scrollEnabled={false}
            />
          </View>
        )}
      </ScrollView>

      {/* Modal for full image view */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => setModalVisible(false)}
          >
            <Feather name="x" size={30} color="#fff" />
          </TouchableOpacity>
          {selectedImage && (
            <Image
              source={{ uri: selectedImage.uri }}
              style={styles.fullImage}
              resizeMode="contain"
            />
          )}
          {selectedImage && (
            <View style={styles.imageInfo}>
              <Text style={styles.imageInfoText}>{selectedImage.filename}</Text>
              <Text style={styles.imageInfoText}>
                {new Date(selectedImage.timestamp).toLocaleString()}
              </Text>
            </View>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const { width } = Dimensions.get("window");
const GRID_ITEM_WIDTH = (width - 40) / 3;

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
    marginTop: 0,
    marginBottom: 10,
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
  statusContainer: {
    marginVertical: 10,
    alignItems: "center",
  },
  captureStatus: {
    color: "green",
    fontWeight: "bold",
    textAlign: "center",
  },
  galleryContainer: {
    width: "100%",
    paddingHorizontal: 10,
    marginTop: 10,
  },
  galleryTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 10,
    color: "#1E293B",
    paddingHorizontal: 5,
  },
  gridRow: {
    justifyContent: "space-between",
    marginBottom: 10,
  },
  gridItem: {
    width: GRID_ITEM_WIDTH,
    height: GRID_ITEM_WIDTH,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#fff",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
  },
  gridImage: {
    width: "100%",
    height: "100%",
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  closeButton: {
    position: "absolute",
    top: 40,
    right: 20,
    zIndex: 10,
    padding: 5,
  },
  fullImage: {
    width: "90%",
    height: "70%",
  },
  imageInfo: {
    position: "absolute",
    bottom: 60,
    backgroundColor: "rgba(0,0,0,0.5)",
    padding: 10,
    width: "100%",
    alignItems: "center",
  },
  imageInfoText: {
    color: "#fff",
    fontSize: 14,
    marginVertical: 2,
  },
});
