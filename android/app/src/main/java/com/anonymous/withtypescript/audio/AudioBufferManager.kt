package com.anonymous.withtypescript.audio

import java.util.ArrayDeque

class AudioBufferManager {
  private val buffers: ArrayDeque<ShortArray> = ArrayDeque()

  @Synchronized
  fun add(buffer: ShortArray) {
    buffers.addLast(buffer)
  }

  @Synchronized
  fun poll(): ShortArray? = if (buffers.isEmpty()) null else buffers.removeFirst()

  @Synchronized
  fun clear() {
    buffers.clear()
  }
}
