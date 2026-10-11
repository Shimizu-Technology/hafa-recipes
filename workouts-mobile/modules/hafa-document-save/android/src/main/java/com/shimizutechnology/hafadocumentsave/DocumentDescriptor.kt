package com.shimizutechnology.hafadocumentsave

import android.os.ParcelFileDescriptor
import java.io.OutputStream

internal fun documentOutput(descriptor: ParcelFileDescriptor): OutputStream {
  try {
    val detectsErrors = descriptor.canDetectErrors()
    // AutoCloseOutputStream alone does not call checkError on API36. It owns the descriptor;
    // retain the same object so errors cached by close can also be checked afterwards.
    // https://android.googlesource.com/platform/frameworks/base/+/android16-release/core/java/android/os/ParcelFileDescriptor.java
    return PeerCheckedOutput(ParcelFileDescriptor.AutoCloseOutputStream(descriptor)) {
      if (detectsErrors) descriptor.checkError()
    }
  } catch (error: Exception) {
    try { descriptor.close() } catch (_: Exception) { /* Preserve primary construction failure. */ }
    throw error
  }
}
