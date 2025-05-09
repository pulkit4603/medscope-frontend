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
  Alert,
} from "react-native";
import CameraInput from "../components/CameraInput";
import { useEffect, useState, useRef } from "react";
import { useLocalSearchParams, router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import { apiurl } from "@/constants/api";

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

interface ImageItem {
  id: string;
  uri: string;
  filename: string;
  timestamp: number;
  medical_assessment?: MedicalAssessment;
}

// New interface for dermoscopic capture
interface DermoscopicCapture {
  globalView: { uri: string } | null;
  regionalView: { uri: string } | null;
  closeUpView: { uri: string } | null;
}

const IMAGES_DIRECTORY = FileSystem.documentDirectory + "medscope-images/";

export default function ImagingScreen() {
  const [captureResult, setCaptureResult] = useState<any>(null);
  const [apiResponse, setApiResponse] = useState<ApiResponse | null>(null);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null);
  const [modalVisible, setModalVisible] = useState<boolean>(false);
  const { testName } = useLocalSearchParams<{ testName: string }>();

  // New state variables for guided capture
  const [captureStep, setCaptureStep] = useState<number>(1);
  const [dermoscopicCaptures, setDermoscopicCaptures] =
    useState<DermoscopicCapture>({
      globalView: null,
      regionalView: null,
      closeUpView: null,
    });
  const [isUploading, setIsUploading] = useState<boolean>(false);

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
        files
          .filter((filename) => !filename.endsWith(".meta.json"))
          .map(async (filename) => {
            const fileUri = IMAGES_DIRECTORY + filename;
            const metadataPath = fileUri + ".meta.json";

            // Try to load medical assessment from metadata file
            let medicalAssessment = undefined;
            try {
              const metadataExists = await FileSystem.getInfoAsync(
                metadataPath
              );
              if (metadataExists.exists) {
                const metadataContent = await FileSystem.readAsStringAsync(
                  metadataPath
                );
                const metadata = JSON.parse(metadataContent);
                medicalAssessment = metadata.medical_assessment;
              }
            } catch (e) {
              console.log("No medical assessment found for", filename);
            }

            const metadata = filename.split("_");
            return {
              id: filename,
              uri: fileUri,
              filename: metadata[0] || "unknown",
              timestamp: parseInt(metadata[1] || Date.now().toString()),
              medical_assessment: medicalAssessment,
            };
          })
      );

      // Sort by timestamp (newest first)
      setImages(imageItems.sort((a, b) => b.timestamp - a.timestamp));
    } catch (error) {
      console.error("Failed to load images:", error);
    }
  };

  const saveImageToDevice = async (
    uri: string,
    filename: string,
    apiResponse?: ApiResponse
  ) => {
    try {
      const timestamp = Date.now();
      const newFilename = `${filename || "image"}_${timestamp}.jpg`;
      const newUri = IMAGES_DIRECTORY + newFilename;

      // Save the image file
      await FileSystem.copyAsync({
        from: uri,
        to: newUri,
      });

      // If we have medical assessment data, save it to a metadata file
      if (apiResponse?.medical_assessment) {
        const metadataPath = newUri + ".meta.json";
        await FileSystem.writeAsStringAsync(
          metadataPath,
          JSON.stringify({
            medical_assessment: apiResponse.medical_assessment,
          })
        );
      }

      const newImage: ImageItem = {
        id: newFilename,
        uri: newUri,
        filename: filename || "image",
        timestamp,
        medical_assessment: apiResponse?.medical_assessment,
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

  const handleCapture = async (result: any, response: any = null) => {
    // Store the captured image in the appropriate step
    switch (captureStep) {
      case 1:
        setDermoscopicCaptures((prev) => ({ ...prev, globalView: result }));
        setCaptureStep(2);
        break;
      case 2:
        setDermoscopicCaptures((prev) => ({ ...prev, regionalView: result }));
        setCaptureStep(3);
        break;
      case 3:
        setDermoscopicCaptures((prev) => ({ ...prev, closeUpView: result }));
        setCaptureStep(4); // Move to upload step
        break;
    }

    setCaptureResult(result);
  };

  // New function to handle the upload of the set of dermoscopic images
  const handleDermoscopicUpload = async () => {
    if (!dermoscopicCaptures.globalView) return;

    setIsUploading(true);

    try {
      // Since we're not capturing anymore (camera hidden in step 4),
      // we need to call the API directly without using cameraRef
      const formData = new FormData();

      // Add the image file with correct parameter name
      const imageFile = {
        uri: dermoscopicCaptures.globalView.uri,
        type: "image/jpeg",
        name: "upload.jpg",
      } as any;

      formData.append("image", imageFile);

      // Send to API
      const response = await fetch(`${apiurl}/upload-image`, {
        method: "POST",
        body: formData,
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API Error (${response.status}):`, errorText);
        throw new Error(
          `Server returned ${response.status}: ${errorText.substring(
            0,
            100
          )}...`
        );
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const responseText = await response.text();
        console.error(
          "Non-JSON response received:",
          responseText.substring(0, 200)
        );
        throw new Error("Server returned non-JSON response");
      }

      const result = await response.json();
      setApiResponse(result);

      // Save all three images to the device
      if (dermoscopicCaptures.globalView) {
        await saveImageToDevice(
          dermoscopicCaptures.globalView.uri,
          "global_view",
          result
        );
      }

      if (dermoscopicCaptures.regionalView) {
        await saveImageToDevice(
          dermoscopicCaptures.regionalView.uri,
          "regional_view"
        );
      }

      if (dermoscopicCaptures.closeUpView) {
        await saveImageToDevice(
          dermoscopicCaptures.closeUpView.uri,
          "close_up_view"
        );
      }

      // Reset the capture process
      setCaptureStep(1);
      setDermoscopicCaptures({
        globalView: null,
        regionalView: null,
        closeUpView: null,
      });
    } catch (error) {
      console.error("Error uploading dermoscopic images:", error);
      setApiResponse({
        error: true,
        message: "Failed to upload dermoscopic images",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleImagePress = (item: ImageItem) => {
    setSelectedImage(item);
    setModalVisible(true);
  };

  // Add a function to delete an image and its metadata
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
      setImages((currentImages) =>
        currentImages.filter((item) => item.id !== imageItem.id)
      );

      // Close the modal if it was open
      setModalVisible(false);
      setSelectedImage(null);
    } catch (error) {
      console.error("Failed to delete image:", error);
      Alert.alert("Error", "Failed to delete the image");
    }
  };

  // Confirm before deleting
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

  // Reference to access uploadImage method
  const cameraRef = useRef<any>(null);

  // Render the appropriate guidance based on capture step
  const renderCaptureGuidance = () => {
    switch (captureStep) {
      case 1:
        return (
          <View style={styles.guidanceContainer}>
            <View style={styles.stepIndicator}>
              <View style={[styles.stepDot, styles.activeStepDot]}></View>
              <View style={styles.stepDot}></View>
              <View style={styles.stepDot}></View>
            </View>
            <Text style={styles.guidanceTitle}>Step 1: Global View</Text>
            <Text style={styles.guidanceText}>
              Capture the lesion and surrounding skin from 15-30 cm away to
              document the site
            </Text>
          </View>
        );
      case 2:
        return (
          <View style={styles.guidanceContainer}>
            <View style={styles.stepIndicator}>
              <View style={[styles.stepDot, styles.completedStepDot]}></View>
              <View style={[styles.stepDot, styles.activeStepDot]}></View>
              <View style={styles.stepDot}></View>
            </View>
            <Text style={styles.guidanceTitle}>Step 2: Regional View</Text>
            <Text style={styles.guidanceText}>
              Capture the lesion from 5-10 cm away to show context
            </Text>
          </View>
        );
      case 3:
        return (
          <View style={styles.guidanceContainer}>
            <View style={styles.stepIndicator}>
              <View style={[styles.stepDot, styles.completedStepDot]}></View>
              <View style={[styles.stepDot, styles.completedStepDot]}></View>
              <View style={[styles.stepDot, styles.activeStepDot]}></View>
            </View>
            <Text style={styles.guidanceTitle}>
              Step 3: Close-up Dermoscopic Image
            </Text>
            <Text style={styles.guidanceText}>
              Capture a close-up (≤ 2 cm) with polarized/non-polarized light to
              reveal subsurface structures
            </Text>
          </View>
        );
      case 4:
        return (
          <View style={styles.guidanceContainer}>
            <View style={styles.stepIndicator}>
              <View style={[styles.stepDot, styles.completedStepDot]}></View>
              <View style={[styles.stepDot, styles.completedStepDot]}></View>
              <View style={[styles.stepDot, styles.completedStepDot]}></View>
            </View>
            <Text style={styles.guidanceTitle}>All views captured!</Text>
            <Text style={styles.guidanceText}>
              Ready to upload for analysis
            </Text>

            <TouchableOpacity
              style={styles.uploadButton}
              onPress={handleDermoscopicUpload}
              disabled={isUploading}
            >
              <Feather name="upload" size={20} color="#fff" />
              <Text style={styles.uploadButtonText}>
                {isUploading ? "Uploading..." : "Upload for Analysis"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.resetButton}
              onPress={() => {
                setCaptureStep(1);
                setDermoscopicCaptures({
                  globalView: null,
                  regionalView: null,
                  closeUpView: null,
                });
              }}
            >
              <Text style={styles.resetButtonText}>Retake Images</Text>
            </TouchableOpacity>
          </View>
        );
      default:
        return null;
    }
  };

  // Show preview of captured images at the top
  const renderImagePreviews = () => {
    return (
      <View style={styles.previewContainer}>
        <View style={styles.previewItem}>
          <View
            style={[
              styles.previewImage,
              dermoscopicCaptures.globalView ? styles.previewImageFilled : null,
            ]}
          >
            {dermoscopicCaptures.globalView && (
              <Image
                source={{ uri: dermoscopicCaptures.globalView.uri }}
                style={styles.previewImageContent}
              />
            )}
          </View>
          <Text style={styles.previewText}>Global</Text>
        </View>

        <View style={styles.previewItem}>
          <View
            style={[
              styles.previewImage,
              dermoscopicCaptures.regionalView
                ? styles.previewImageFilled
                : null,
            ]}
          >
            {dermoscopicCaptures.regionalView && (
              <Image
                source={{ uri: dermoscopicCaptures.regionalView.uri }}
                style={styles.previewImageContent}
              />
            )}
          </View>
          <Text style={styles.previewText}>Regional</Text>
        </View>

        <View style={styles.previewItem}>
          <View
            style={[
              styles.previewImage,
              dermoscopicCaptures.closeUpView
                ? styles.previewImageFilled
                : null,
            ]}
          >
            {dermoscopicCaptures.closeUpView && (
              <Image
                source={{ uri: dermoscopicCaptures.closeUpView.uri }}
                style={styles.previewImageContent}
              />
            )}
          </View>
          <Text style={styles.previewText}>Close-up</Text>
        </View>
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
          <Text style={styles.title}>{testName || "Imaging"}</Text>
          <Text style={styles.subtitle}>
            Capture standardized dermoscopy views
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Image preview section */}
        {renderImagePreviews()}

        {/* Guidance section */}
        {renderCaptureGuidance()}

        {/* Only show camera in steps 1-3 */}
        {captureStep < 4 && (
          <View style={styles.cameraContainer}>
            <CameraInput
              ref={cameraRef}
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
        )}

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
          <ScrollView style={styles.modalScrollView}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setModalVisible(false)}
            >
              <Feather name="x" size={30} color="#fff" />
            </TouchableOpacity>

            {selectedImage && (
              <View style={styles.modalContent}>
                <Image
                  source={{ uri: selectedImage.uri }}
                  style={styles.fullImage}
                  resizeMode="contain"
                />

                {selectedImage.medical_assessment ? (
                  <View style={styles.medicalAssessmentContainer}>
                    <View style={styles.medicalAssessmentHeader}>
                      <Feather name="activity" size={22} color="#3B82F6" />
                      <Text style={styles.medicalAssessmentTitle}>
                        Medical Assessment
                      </Text>
                    </View>

                    <View style={styles.assessmentSection}>
                      <Text style={styles.assessmentLabel}>Diagnosis</Text>
                      <View style={styles.diagnosisPill}>
                        <Text style={styles.diagnosisText}>
                          {selectedImage.medical_assessment.diagnosis}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.assessmentSection}>
                      <Text style={styles.assessmentLabel}>Findings</Text>
                      <Text style={styles.assessmentText}>
                        {selectedImage.medical_assessment.findings}
                      </Text>
                    </View>

                    <View style={styles.assessmentSection}>
                      <Text style={styles.assessmentLabel}>Recommendation</Text>
                      <Text style={styles.assessmentText}>
                        {selectedImage.medical_assessment.recommendation}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.noAssessmentContainer}>
                    <Text style={styles.noAssessmentText}>
                      No medical assessment available
                    </Text>
                  </View>
                )}

                <View style={styles.imageInfo}>
                  <Text style={styles.imageInfoText}>
                    {selectedImage.filename}
                  </Text>
                  <Text style={styles.imageInfoText}>
                    {new Date(selectedImage.timestamp).toLocaleString()}
                  </Text>

                  {/* Delete button */}
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => confirmDelete(selectedImage)}
                  >
                    <Feather name="trash-2" size={20} color="#fff" />
                    <Text style={styles.deleteButtonText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>
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
  },
  modalScrollView: {
    flex: 1,
    marginTop: 40,
  },
  modalContent: {
    alignItems: "center",
    padding: 15,
  },
  closeButton: {
    position: "absolute",
    top: 10,
    right: 15,
    zIndex: 10,
    width: 40,
    height: 40,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  fullImage: {
    width: width * 0.9,
    height: width * 0.9,
    borderRadius: 8,
    marginBottom: 15,
  },
  medicalAssessmentContainer: {
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderRadius: 12,
    padding: 16,
    width: width * 0.9,
    marginBottom: 20,
  },
  medicalAssessmentHeader: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    paddingBottom: 12,
    marginBottom: 12,
  },
  medicalAssessmentTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginLeft: 8,
    color: "#1E293B",
  },
  assessmentSection: {
    marginBottom: 14,
  },
  assessmentLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#64748B",
    marginBottom: 6,
  },
  assessmentText: {
    fontSize: 15,
    color: "#334155",
    lineHeight: 22,
  },
  diagnosisPill: {
    backgroundColor: "#EFF6FF",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: "flex-start",
  },
  diagnosisText: {
    color: "#3B82F6",
    fontWeight: "600",
    fontSize: 15,
  },
  noAssessmentContainer: {
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
  },
  noAssessmentText: {
    color: "#64748B",
    fontStyle: "italic",
  },
  imageInfo: {
    padding: 10,
    width: "100%",
    alignItems: "center",
  },
  imageInfoText: {
    color: "#fff",
    fontSize: 14,
    marginVertical: 2,
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#DC2626",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 12,
  },
  deleteButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 6,
  },
  guidanceContainer: {
    alignItems: "center",
    marginVertical: 20,
    paddingHorizontal: 20,
  },
  stepIndicator: {
    flexDirection: "row",
    marginBottom: 10,
  },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#E2E8F0",
    marginHorizontal: 5,
  },
  activeStepDot: {
    backgroundColor: "#3B82F6",
  },
  completedStepDot: {
    backgroundColor: "#10B981",
  },
  guidanceTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1E293B",
    marginBottom: 8,
  },
  guidanceText: {
    fontSize: 14,
    color: "#64748B",
    textAlign: "center",
  },
  uploadButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#3B82F6",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginTop: 20,
  },
  uploadButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
  resetButton: {
    marginTop: 10,
  },
  resetButtonText: {
    color: "#3B82F6",
    fontSize: 14,
    fontWeight: "600",
  },
  previewContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    width: "100%",
    paddingHorizontal: 20,
    marginVertical: 20,
  },
  previewItem: {
    alignItems: "center",
  },
  previewImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: "#E2E8F0",
    justifyContent: "center",
    alignItems: "center",
  },
  previewImageFilled: {
    backgroundColor: "transparent",
  },
  previewImageContent: {
    width: "100%",
    height: "100%",
    borderRadius: 8,
  },
  previewText: {
    marginTop: 5,
    fontSize: 12,
    color: "#64748B",
  },
});
