package com.shimizutechnology.hafadocumentsave

import java.io.OutputStream

/** Keep both checks: Android's descriptor close can cache a peer error without throwing it. */
internal class PeerCheckedOutput(private val output: OutputStream, private val checkPeer: () -> Unit) : OutputStream() {
  override fun write(value: Int) = output.write(value)
  override fun write(buffer: ByteArray, offset: Int, count: Int) = output.write(buffer, offset, count)
  override fun flush() = output.flush()

  override fun close() {
    var failure: Exception? = null
    // A pre-close check may consume an error that close subsequently replaces with an empty status.
    // Preserve that failure while still closing the owning stream/descriptor.
    try { checkPeer() } catch (error: Exception) { failure = error }
    try { output.close() } catch (error: Exception) { if (failure == null) failure = error }
    try { checkPeer() } catch (error: Exception) { if (failure == null) failure = error }
    failure?.let { throw it }
  }
}
