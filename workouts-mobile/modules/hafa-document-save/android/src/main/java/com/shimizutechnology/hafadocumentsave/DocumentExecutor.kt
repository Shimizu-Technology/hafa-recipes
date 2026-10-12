package com.shimizutechnology.hafadocumentsave

import java.util.concurrent.ExecutorService

internal fun shutdownDocumentExecutor(executor: ExecutorService, scheduleCleanup: () -> Unit) {
  try { scheduleCleanup() }
  finally { executor.shutdown() } // Orderly: preserve queued/running work, reject new submissions.
}
