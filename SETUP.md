# Medscope Setup Guide

## Prerequisites

### 1. Android Development Tools

Install the following tools to run the app on your Android device:

#### Android Studio
- **Windows/macOS/Linux**: [Download Android Studio](https://developer.android.com/studio)
- Install and open Android Studio, then go to: `Settings > Languages & Frameworks > Android SDK`
- Install latest SDK Platform and Android SDK Build-Tools

#### Android SDK Command Line Tools
- **Linux**: 
  ```bash
  wget https://dl.google.com/android/repository/commandlinetools-linux-9477386_latest.zip
  unzip commandlinetools-linux-9477386_latest.zip -d $HOME/Android/Sdk/cmdline-tools
  mv $HOME/Android/Sdk/cmdline-tools/cmdline-tools $HOME/Android/Sdk/cmdline-tools/latest
  ```
- **macOS**: 
  ```bash
  wget https://dl.google.com/android/repository/commandlinetools-mac-9477386_latest.zip
  unzip commandlinetools-mac-9477386_latest.zip -d $HOME/Library/Android/sdk/cmdline-tools
  mv $HOME/Library/Android/sdk/cmdline-tools/cmdline-tools $HOME/Library/Android/sdk/cmdline-tools/latest
  ```
- **Windows**: [Download from here](https://developer.android.com/studio#command-tools) and extract to `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest`

#### Set Environment Variables
Add to your `.bashrc` / `.zshrc` (Linux/macOS) or System Environment Variables (Windows):
```bash
export ANDROID_HOME=$HOME/Android/Sdk  # macOS: $HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin
```

### 2. Install Dependencies
```bash
npm install
npm install --global @expo/ngrok@^4.1.0
npm install -g @expo/cli eas-cli
```

### 3. Build and Run
```bash
npx expo prebuild --clean
npx expo run:android
```

---

## Configuration Changes Required

### File: `constants/api.ts`

Update these URLs to point to your machine learning model servers:

```typescript
export const apiurl = "YOUR_ML_SERVER_URL";          // Main API server
export const audioApiUrl = `${apiurl}/send-audio`;   // Audio processing endpoint
export const cameraServerUrl = "YOUR_CAMERA_HELPER_SERVER_URL";  // Camera relay server
export const dermatoscopyApiUrl = "YOUR_DERMATO_ML_MODEL_URL";   // Skin analysis model
```

**What these do:**
- `apiurl`: Main server handling general API requests
- `audioApiUrl`: Server that processes heart sound audio files
- `cameraServerUrl`: Helper server that converts TCP data to HTTP (for microcontroller communication)
- `dermatoscopyApiUrl`: Server running the skin condition detection model

---

### File: `app/pharyngoscopy.tsx`

Update the ML model URL:

```typescript
const RENDER_API_URL = "YOUR_PHARYNGO_ML_MODEL_URL";  // Line 44
```

**What this does:** Server running the throat analysis model for pharyngitis detection

---

### File: `app/dermatoscopy.tsx`

Update the ML model URL:

```typescript
const RENDER_API_URL = "YOUR_DERMATO_ML_MODEL_URL";  // Line 40
```

**What this does:** Server running the skin condition analysis model

---

### File: `app/auscultation.tsx`

Update USB device identifiers and API endpoint:

```typescript
const USB_VENDOR_ID = 0x1234;  // Line 32 - Replace with your stethoscope device's vendor ID
const USB_PRODUCT_ID = 0x5678;  // Line 33 - Replace with your stethoscope device's product ID
const USB_BAUD_RATE = 115200;   // Line 34 - Adjust if your device uses different speed
const AUSCULTATION_API_URL = "YOUR_HEART_SOUND_ML_MODEL_URL";  // Line 37
```

**What these do:**
- USB IDs: Identify your digital stethoscope device when connected
- Baud rate: Communication speed with the stethoscope (usually 9600, 115200, or 921600)
- API URL: Server that analyzes heart sounds for abnormalities

**How to find USB IDs:**
- Connect device to computer
- **Linux**: Run `lsusb` in terminal
- **macOS**: Use System Information > USB
- **Windows**: Use Device Manager > USB Controllers

---

## Network Setup for Microcontrollers

### Phone Configuration
1. **Enable Mobile Hotspot** on your Android phone
2. Note down the hotspot IP address (usually `192.168.43.1` or similar)
3. Find it in: `Settings > Network & Internet > Hotspot & tethering > Wi-Fi hotspot > Advanced`

### Microcontroller Configuration
Your microcontrollers (camera devices for pharyngoscopy/dermatoscopy) must be programmed with:
- **Phone's IP address**: The IP shown in hotspot settings
- **Port**: `8080` (matches `TCP_PORT` in the app)
- **Connection type**: TCP client connecting to phone's IP

**Example**: If phone IP is `192.168.43.1`, program microcontroller to connect to `192.168.43.1:8080`

---

## Testing

1. Turn on phone hotspot
2. Connect microcontrollers to phone's hotspot network
3. Run the app: `npx expo run:android`
4. Check connection status indicators in each test screen

---

## Troubleshooting

- **"Disconnected" status**: Check if microcontroller is on same network as phone
- **"Failed to analyze"**: Verify ML model URLs are accessible and running
- **USB device not found**: Confirm USB vendor/product IDs match your device
- **Build errors**: Run `npx expo prebuild --clean` again

---

## Quick Reference: Port Numbers

- **TCP Server (app listens)**: Port `8080` - for camera devices
- **USB Serial**: Baud rate `115200` - for stethoscope device
