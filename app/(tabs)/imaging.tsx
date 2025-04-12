import { StyleSheet, Text, View, Button } from "react-native";
import CameraInput from "../../components/CameraInput";
import { useState } from "react";

export default function ImagingScreen() {
  const [captureResult, setCaptureResult] = useState(null);

  // Custom permission denied handler
  const handlePermissionDenied = () => (
    <View style={styles.container}>
      <Text style={styles.message}>
        Camera access is required for this feature
      </Text>
      <Button title="Request Permission" onPress={() => {}} />
    </View>
  );

  const handleCapture = (result: any) => {
    setCaptureResult(result);
    console.log("Image captured and uploaded:", result);
  };

  return (
    <View style={styles.container}>
      <CameraInput
        width={300}
        height={400}
        facing="back"
        onPermissionDenied={handlePermissionDenied}
        onCapture={handleCapture}
      />
      {captureResult && (
        <Text style={styles.captureStatus}>Image captured and sent to API</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
  },
  message: {
    textAlign: "center",
    paddingBottom: 10,
  },
  captureStatus: {
    marginTop: 15,
    color: "green",
    fontWeight: "bold",
  },
});
