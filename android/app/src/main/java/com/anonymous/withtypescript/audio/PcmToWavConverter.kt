package com.anonymous.withtypescript.audio

import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

object PcmToWavConverter {
  fun writeWavFile(pcmData: ShortArray, filePath: String, sampleRate: Int = 16000) {
    val byteBuffer = ByteBuffer.allocate(pcmData.size * 2).order(ByteOrder.LITTLE_ENDIAN)
    pcmData.forEach { byteBuffer.putShort(it) }
    val pcmBytes = byteBuffer.array()

    val wavFile = File(filePath)
    FileOutputStream(wavFile).use { output ->
      val header = createWavHeader(pcmBytes.size, sampleRate)
      output.write(header)
      output.write(pcmBytes)
      output.flush()
    }
  }

  private fun createWavHeader(pcmDataLength: Int, sampleRate: Int): ByteArray {
    val totalDataLen = pcmDataLength + 36
    val byteRate = sampleRate * 2

    return ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
      put("RIFF".toByteArray())
      putInt(totalDataLen)
      put("WAVE".toByteArray())
      put("fmt ".toByteArray())
      putInt(16)
      putShort(1)
      putShort(1)
      putInt(sampleRate)
      putInt(byteRate)
      putShort(2)
      putShort(16)
      put("data".toByteArray())
      putInt(pcmDataLength)
    }.array()
  }
}
