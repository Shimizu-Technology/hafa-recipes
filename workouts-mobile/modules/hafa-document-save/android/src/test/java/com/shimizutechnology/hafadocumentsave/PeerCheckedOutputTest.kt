package com.shimizutechnology.hafadocumentsave

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException

class PeerCheckedOutputTest {
  @Test fun reportedPeerErrorCannotBeErasedBySuccessfulDescriptorClose() {
    var reported = true; var closed = false; var checks = 0
    val target = object : ByteArrayOutputStream() {
      override fun close() { closed = true; reported = false; super.close() }
    }
    val output = PeerCheckedOutput(target) { checks++; if (reported) throw IOException("synthetic provider failed") }
    assertThrows(IOException::class.java) {
      DocumentCopy.copy(1, { false }, { ByteArrayInputStream(byteArrayOf(1)) }, { output })
    }
    assertTrue(closed); assertEquals(2, checks); assertArrayEquals(byteArrayOf(1), target.toByteArray())
  }
  @Test fun errorCachedDuringDescriptorClosePreventsSuccessfulCopy() {
    var cachedError = false; var checks = 0
    val target = object : ByteArrayOutputStream() {
      override fun close() { cachedError = true; super.close() }
    }
    val output = PeerCheckedOutput(target) { checks++; if (cachedError) throw IOException("synthetic close peer failure") }
    assertThrows(IOException::class.java) {
      DocumentCopy.copy(1, { false }, { ByteArrayInputStream(byteArrayOf(1)) }, { output })
    }
    assertEquals(2, checks)
  }
  @Test fun closeFailureStillPerformsPostCloseCheckAndPreservesPrimaryError() {
    val primary = IOException("synthetic close failure"); var checks = 0
    val target = object : ByteArrayOutputStream() { override fun close() { throw primary } }
    val output = PeerCheckedOutput(target) { checks++; if (checks == 2) throw IOException("secondary peer failure") }
    assertSame(primary, assertThrows(IOException::class.java) { output.close() }); assertEquals(2, checks)
  }
  @Test fun peerChecksAndOwnedClosureCompleteBeforeSuccess() {
    val events = mutableListOf<String>()
    val target = object : ByteArrayOutputStream() { override fun close() { events.add("close"); super.close() } }
    val output = PeerCheckedOutput(target) { events.add("check") }
    assertEquals(1L, DocumentCopy.copy(1, { false }, { ByteArrayInputStream(byteArrayOf(1)) }, { output }))
    assertEquals(listOf("check", "close", "check"), events)
  }
}
