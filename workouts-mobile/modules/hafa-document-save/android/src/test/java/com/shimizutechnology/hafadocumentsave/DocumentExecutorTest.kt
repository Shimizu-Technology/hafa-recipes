package com.shimizutechnology.hafadocumentsave

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class DocumentExecutorTest {
  @Test fun destructionPreservesRunningCopyAndBothQueuedCleanupTasks() {
    val executor = Executors.newSingleThreadExecutor()
    val entered = CountDownLatch(1); val release = CountDownLatch(1)
    val runningFinished = AtomicBoolean(false); val oldCleanup = AtomicBoolean(false); val destroyCleanup = AtomicBoolean(false)
    try {
      executor.execute { entered.countDown(); release.await(1, TimeUnit.SECONDS); runningFinished.set(true) }
      assertTrue(entered.await(1, TimeUnit.SECONDS))
      executor.execute { oldCleanup.set(true) }
      shutdownDocumentExecutor(executor) { executor.execute { destroyCleanup.set(true) } }
      assertTrue(executor.isShutdown); assertFalse(executor.isTerminated)
      assertThrows(RejectedExecutionException::class.java) { executor.execute {} }
      release.countDown(); assertTrue(executor.awaitTermination(1, TimeUnit.SECONDS))
      assertTrue(runningFinished.get()); assertTrue(oldCleanup.get()); assertTrue(destroyCleanup.get())
    } finally {
      release.countDown(); executor.shutdownNow(); executor.awaitTermination(1, TimeUnit.SECONDS)
    }
  }
  @Test fun unknownPickerDestinationNeedsNoCallbackToShutdownIdleWorker() {
    val executor = Executors.newSingleThreadExecutor()
    try {
      executor.submit {}.get(1, TimeUnit.SECONDS)
      shutdownDocumentExecutor(executor) { /* No known URI can be cleaned. */ }
      assertTrue(executor.awaitTermination(1, TimeUnit.SECONDS))
    } finally { executor.shutdownNow(); executor.awaitTermination(1, TimeUnit.SECONDS) }
  }
  @Test fun evenASchedulingFailureCannotLeaveExecutorOpen() {
    val executor = Executors.newSingleThreadExecutor()
    try {
      assertThrows(IllegalStateException::class.java) {
        shutdownDocumentExecutor(executor) { throw IllegalStateException("synthetic scheduling failure") }
      }
      assertTrue(executor.isShutdown)
    } finally { executor.shutdownNow(); executor.awaitTermination(1, TimeUnit.SECONDS) }
  }
}
