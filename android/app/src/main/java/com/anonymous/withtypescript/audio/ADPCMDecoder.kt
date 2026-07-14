package com.anonymous.withtypescript.audio

class ADPCMDecoder {
  private val indexTable = intArrayOf(
    -1, -1, -1, -1, 2, 4, 6, 8,
    -1, -1, -1, -1, 2, 4, 6, 8
  )

  private val stepSizeTable = intArrayOf(
    7, 8, 9, 10, 11, 12, 13, 14,
    16, 17, 19, 21, 23, 25, 28, 31,
    34, 37, 41, 45, 50, 55, 60, 66,
    73, 80, 88, 97, 107, 118, 130, 143,
    157, 173, 190, 209, 230, 253, 279, 307,
    337, 371, 408, 449, 494, 544, 598, 658,
    724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552
  )

  private var predictor = 0
  private var index = 0

  fun reset() {
    predictor = 0
    index = 0
  }

  fun decode(adpcmData: ByteArray): ShortArray {
    val pcm = ShortArray(adpcmData.size * 2)

    for (i in adpcmData.indices) {
      val b = adpcmData[i].toInt() and 0xFF
      pcm[i * 2] = decodeNibble(b and 0x0F)
      pcm[i * 2 + 1] = decodeNibble((b shr 4) and 0x0F)
    }

    return pcm
  }

  private fun decodeNibble(nibble: Int): Short {
    val step = stepSizeTable[index]
    var diff = step shr 3

    if ((nibble and 4) != 0) diff += step
    if ((nibble and 2) != 0) diff += step shr 1
    if ((nibble and 1) != 0) diff += step shr 2
    if ((nibble and 8) != 0) diff = -diff

    predictor += diff
    predictor = predictor.coerceIn(-32768, 32767)

    index += indexTable[nibble]
    index = index.coerceIn(0, stepSizeTable.size - 1)

    return predictor.toShort()
  }
}
