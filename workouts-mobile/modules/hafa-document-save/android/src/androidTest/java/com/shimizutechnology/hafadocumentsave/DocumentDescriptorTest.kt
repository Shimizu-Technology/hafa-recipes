package com.shimizutechnology.hafadocumentsave

import android.os.ParcelFileDescriptor
import android.system.Os
import android.test.AndroidTestCase
import java.io.IOException
import junit.framework.Assert.assertEquals
import junit.framework.Assert.assertFalse
import junit.framework.Assert.assertTrue

/** Real platform descriptors, fixed synthetic status only; no document/provider/UI is opened. */
class DocumentDescriptorTest : AndroidTestCase() {
  fun testAutoCloseAloneCachesPeerFailureWithoutThrowing() {
    val pair = ParcelFileDescriptor.createReliableSocketPair()
    try {
      val output = ParcelFileDescriptor.AutoCloseOutputStream(pair[1])
      output.write(1); assertEquals(1, Os.read(pair[0].fileDescriptor, ByteArray(1), 0, 1))
      pair[0].closeWithError("synthetic provider failure")
      output.close() // API36 caches remote failure, but does not throw it here.
      var failed = false
      try { pair[1].checkError() } catch (_: IOException) { failed = true }
      assertTrue(failed)
    } finally { pair.forEach { try { it.close() } catch (_: Exception) {} } }
  }
  fun testOwnedDocumentOutputReportsPeerFailureAfterSuccessfulWrite() {
    val pair = ParcelFileDescriptor.createReliableSocketPair()
    try {
      val output = documentOutput(pair[1])
      output.write(1); assertEquals(1, Os.read(pair[0].fileDescriptor, ByteArray(1), 0, 1))
      pair[0].closeWithError("synthetic provider failure")
      var failed = false
      try { output.close() } catch (_: IOException) { failed = true }
      assertTrue(failed); assertFalse(pair[1].fileDescriptor.valid())
    } finally { pair.forEach { try { it.close() } catch (_: Exception) {} } }
  }
}
