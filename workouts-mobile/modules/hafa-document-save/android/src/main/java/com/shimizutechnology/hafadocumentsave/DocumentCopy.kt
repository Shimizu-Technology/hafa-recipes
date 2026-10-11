package com.shimizutechnology.hafadocumentsave

import java.io.InputStream
import java.io.OutputStream

internal class DocumentCopyStopped : Exception()

/** Byte/buffer bounded. Provider I/O can block; cancellation is not evidence it has ended. */
internal object DocumentCopy {
  const val MAX_BYTES = 64L * 1024 * 1024
  const val BUFFER_BYTES = 64 * 1024

  fun copy(expectedBytes: Long, stopped: () -> Boolean,
    openInput: () -> InputStream, openOutput: () -> OutputStream): Long {
    require(expectedBytes in 1..MAX_BYTES)
    fun check() { if (stopped()) throw DocumentCopyStopped() }
    check()
    var count = 0L
    openInput().use { input ->
      check()
      openOutput().use { output ->
        val buffer = ByteArray(BUFFER_BYTES)
        while (true) {
          check()
          val read = input.read(buffer)
          check()
          if (read < 0) break
          if (read == 0) throw IllegalStateException()
          require(count + read <= expectedBytes && count + read <= MAX_BYTES)
          output.write(buffer, 0, read)
          count += read
        }
        require(count == expectedBytes)
        check()
        output.flush()
        check()
      } // A close error is a failed copy, never successful completion.
    }
    check()
    return count
  }
}
