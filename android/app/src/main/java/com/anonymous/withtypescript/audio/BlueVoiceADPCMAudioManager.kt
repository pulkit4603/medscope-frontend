package com.anonymous.withtypescript.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import java.io.File

class BlueVoiceADPCMAudioManager {
  companion object {
    const val SAMPLE_RATE = 16000
  }

  private val decoder = ADPCMDecoder()
  private val bufferManager = AudioBufferManager()
  private var audioTrack: AudioTrack? = null
  private var isStreaming = false
  private var isRecording = false
  private val recordingData: MutableList<ShortArray> = mutableListOf()
  private var recordingFile: File? = null

  @Synchronized
  fun startAudioStreaming() {
    if (audioTrack == null) {
      audioTrack = AudioTrack(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build(),
        AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setSampleRate(SAMPLE_RATE)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .build(),
        SAMPLE_RATE * 2,
        AudioTrack.MODE_STREAM,
        AudioManager.AUDIO_SESSION_ID_GENERATE
      )
    }

    audioTrack?.play()
    isStreaming = true
  }

  @Synchronized
  fun stopAudioStreaming() {
    isStreaming = false
    audioTrack?.stop()
    audioTrack?.release()
    audioTrack = null
  }

  @Synchronized
  fun startRecording(file: File) {
    isRecording = true
    recordingFile = file
    recordingData.clear()
    decoder.reset()
    bufferManager.clear()
  }

  @Synchronized
  fun stopRecording(): File? {
    isRecording = false
    val file = recordingFile ?: return null
    val allPcm = mergeRecordingData()
    PcmToWavConverter.writeWavFile(allPcm, file.absolutePath, SAMPLE_RATE)
    return file
  }

  @Synchronized
  fun updateAudio(adpcmData: ByteArray) {
    val pcm = decoder.decode(adpcmData)
    bufferManager.add(pcm)

    if (isStreaming) {
      audioTrack?.write(pcm, 0, pcm.size)
    }

    if (isRecording) {
      recordingData.add(pcm)
    }
  }

  @Synchronized
  private fun mergeRecordingData(): ShortArray {
    val totalLength = recordingData.sumOf { it.size }
    val all = ShortArray(totalLength)

    var pos = 0
    for (arr in recordingData) {
      System.arraycopy(arr, 0, all, pos, arr.size)
      pos += arr.size
    }

    return all
  }
}
