package com.shimizutechnology.hafadocumentsave

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

class DocumentCopyTest {
  @Test fun completeBytesFlushAndCloseBeforeReturn() {
    val bytes = ByteArray(DocumentCopy.BUFFER_BYTES * 2 + 17) { (it % 251).toByte() }
    var flushed = false
    var closed = false
    val target = object : ByteArrayOutputStream() {
      override fun flush() { flushed = true; super.flush() }
      override fun close() { assertTrue(flushed); closed = true; super.close() }
    }
    val copied = DocumentCopy.copy(bytes.size.toLong(), { false }, { ByteArrayInputStream(bytes) }, { target })
    assertTrue(closed); assertEquals(bytes.size.toLong(), copied); assertArrayEquals(bytes, target.toByteArray())
  }
  @Test fun maximumStreamUsesOnlyBoundedChunks() {
    var left = DocumentCopy.MAX_BYTES
    var largest = 0
    val input = object : InputStream() {
      override fun read(): Int = error("Single byte reads are not used")
      override fun read(buffer: ByteArray, offset: Int, count: Int): Int {
        largest = maxOf(largest, count)
        if (left == 0L) return -1
        val read = minOf(left, count.toLong()).toInt(); left -= read; return read
      }
    }
    val output = object : OutputStream() {
      override fun write(value: Int) = error("Single byte writes are not used")
      override fun write(buffer: ByteArray, offset: Int, count: Int) { assertTrue(count <= DocumentCopy.BUFFER_BYTES) }
    }
    assertEquals(DocumentCopy.MAX_BYTES, DocumentCopy.copy(DocumentCopy.MAX_BYTES, { false }, { input }, { output }))
    assertEquals(DocumentCopy.BUFFER_BYTES, largest)
  }
  @Test fun rejectsOversizeBeforeOpeningDestination() {
    var opened = false
    assertThrows(IllegalArgumentException::class.java) {
      DocumentCopy.copy(DocumentCopy.MAX_BYTES + 1, { false }, { ByteArrayInputStream(byteArrayOf(1)) },
        { opened = true; ByteArrayOutputStream() })
    }
    assertFalse(opened)
  }
  @Test fun sourceGrowthAndTruncationFailWithoutSuccess() {
    for (size in listOf(1, 3)) {
      assertThrows(IllegalArgumentException::class.java) {
        DocumentCopy.copy(2, { false }, { ByteArrayInputStream(ByteArray(size)) }, { ByteArrayOutputStream() })
      }
    }
  }
  @Test fun stoppedBeforeOpeningProducesNoDestination() {
    var opened = false
    assertThrows(DocumentCopyStopped::class.java) {
      DocumentCopy.copy(1, { true }, { ByteArrayInputStream(byteArrayOf(1)) }, { opened = true; ByteArrayOutputStream() })
    }
    assertFalse(opened)
  }
  @Test fun cancellationBetweenReadAndWriteProducesNoPrivateBytes() {
    var stopped = false
    val input = object : ByteArrayInputStream(ByteArray(10)) {
      override fun read(buffer: ByteArray, offset: Int, count: Int): Int {
        val read = super.read(buffer, offset, count); stopped = true; return read
      }
    }
    val output = ByteArrayOutputStream()
    assertThrows(DocumentCopyStopped::class.java) { DocumentCopy.copy(10, { stopped }, { input }, { output }) }
    assertEquals(0, output.size())
  }
  @Test fun cancelledAfterFirstChunkClosesStreamsWithoutMoreWrites() {
    var stopped = false; var closed = false
    val output = object : ByteArrayOutputStream() {
      override fun write(buffer: ByteArray, offset: Int, count: Int) { super.write(buffer, offset, count); stopped = true }
      override fun close() { closed = true; super.close() }
    }
    assertThrows(DocumentCopyStopped::class.java) {
      DocumentCopy.copy((DocumentCopy.BUFFER_BYTES * 2).toLong(), { stopped },
        { ByteArrayInputStream(ByteArray(DocumentCopy.BUFFER_BYTES * 2)) }, { output })
    }
    assertTrue(closed); assertEquals(DocumentCopy.BUFFER_BYTES, output.size())
  }
  @Test fun openWriteFlushAndCloseErrorsNeverAcknowledgeSuccess() {
    for (phase in listOf("open", "write", "flush", "close")) {
      assertThrows(IOException::class.java) {
        DocumentCopy.copy(1, { false }, { ByteArrayInputStream(byteArrayOf(1)) }, {
          if (phase == "open") throw IOException("private path must stay native")
          object : OutputStream() {
            override fun write(value: Int) { if (phase == "write") throw IOException() }
            override fun write(buffer: ByteArray, offset: Int, count: Int) { if (phase == "write") throw IOException() }
            override fun flush() { if (phase == "flush") throw IOException() }
            override fun close() { if (phase == "close") throw IOException() }
          }
        })
      }
    }
  }
  @Test fun inputCloseErrorAlsoFails() {
    assertThrows(IOException::class.java) {
      DocumentCopy.copy(1, { false }, { object : ByteArrayInputStream(byteArrayOf(1)) {
        override fun close() { throw IOException() }
      } }, { ByteArrayOutputStream() })
    }
  }
}
