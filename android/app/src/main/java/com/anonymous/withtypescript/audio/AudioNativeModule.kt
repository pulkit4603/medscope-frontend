package com.anonymous.withtypescript.audio

import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

class AudioNativeModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val manager = BlueVoiceADPCMAudioManager()
  private var activeRecordingFile: File? = null

  override fun getName(): String = "AudioNativeModule"

  @ReactMethod
  fun startStreaming(promise: Promise) {
    try {
      manager.startAudioStreaming()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_STREAM_START", "Failed to start native audio streaming", e)
    }
  }

  @ReactMethod
  fun stopStreaming(promise: Promise) {
    try {
      manager.stopAudioStreaming()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_STREAM_STOP", "Failed to stop native audio streaming", e)
    }
  }

  @ReactMethod
  fun startRecording(sessionName: String?, promise: Promise) {
    try {
      val outDir = File(reactContext.cacheDir, "auscultation")
      if (!outDir.exists()) {
        outDir.mkdirs()
      }

      val safeSession = (sessionName ?: "session")
        .replace("[^a-zA-Z0-9._-]".toRegex(), "_")
      val outputFile = File(outDir, "${safeSession}_${System.currentTimeMillis()}.wav")

      activeRecordingFile = outputFile
      manager.startRecording(outputFile)
      promise.resolve("file://${outputFile.absolutePath}")
    } catch (e: Exception) {
      promise.reject("E_RECORD_START", "Failed to start native recording", e)
    }
  }

  @ReactMethod
  fun pushAdpcmChunkBase64(base64Chunk: String, promise: Promise) {
    try {
      val bytes = Base64.decode(base64Chunk, Base64.DEFAULT)
      manager.updateAudio(bytes)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_CHUNK_PUSH", "Failed to push ADPCM chunk to native decoder", e)
    }
  }

  @ReactMethod
  fun stopRecording(promise: Promise) {
    try {
      val file = manager.stopRecording() ?: activeRecordingFile
      if (file == null || !file.exists()) {
        promise.reject("E_RECORD_STOP", "No output file was produced by native recording")
        return
      }

      promise.resolve("file://${file.absolutePath}")
    } catch (e: Exception) {
      promise.reject("E_RECORD_STOP", "Failed to stop native recording", e)
    }
  }
}
