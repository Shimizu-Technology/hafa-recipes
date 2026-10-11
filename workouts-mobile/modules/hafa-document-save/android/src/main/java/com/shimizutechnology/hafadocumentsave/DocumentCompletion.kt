package com.shimizutechnology.hafadocumentsave

/** Linearize the final decision and saved acknowledgement with the owner's cancel lock. */
internal fun commitDocumentCopy(lock: Any, stopped: () -> Boolean, acknowledge: () -> Unit) {
  synchronized(lock) {
    if (stopped()) throw DocumentCopyStopped()
    acknowledge()
  }
}

/** Access only under the operation lock; each callback can take its promise at most once. */
internal class PickerPromiseOwner<T : Any>(initial: T) {
  private var pending: T? = initial
  fun hasPending() = pending != null
  fun take(expected: T? = null): T? {
    val value = pending ?: return null
    if (expected != null && value !== expected) return null
    pending = null
    return value
  }
}

internal fun <T : Any> takePickerLaunchFailure(lock: Any, picker: PickerPromiseOwner<T>?,
  expected: T, retire: () -> Unit): Boolean = synchronized(lock) {
  // Validation can fail before a Save/slot exists; that original promise still needs a result.
  if (picker == null) true
  else if (picker.take(expected) != null) { retire(); true }
  else false
}
