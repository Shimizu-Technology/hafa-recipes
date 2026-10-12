package com.shimizutechnology.hafadocumentsave

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

class DocumentCompletionTest {
  @Test fun cancelAfterStreamCloseButBeforeCommitDiscardsInsteadOfSaving() {
    val lock = Any(); var stopped = false
    val copied = CountDownLatch(1); val commit = CountDownLatch(1)
    val saved = AtomicBoolean(false); val discarded = AtomicBoolean(false)
    val error = AtomicReference<Throwable?>(null)
    val worker = thread {
      try {
        // Force the exact gap after the real stream engine's last cancellation check.
        DocumentCopy.copy(1, { synchronized(lock) { stopped } },
          { ByteArrayInputStream(byteArrayOf(1)) }, { ByteArrayOutputStream() })
        copied.countDown(); check(commit.await(2, TimeUnit.SECONDS))
        try { commitDocumentCopy(lock, { stopped }) { saved.set(true) } }
        catch (_: DocumentCopyStopped) { discarded.set(true) }
      } catch (failure: Throwable) { error.set(failure) }
    }
    try {
      assertTrue(copied.await(2, TimeUnit.SECONDS))
      synchronized(lock) { stopped = true } // cancel wins before acknowledgement.
      commit.countDown(); worker.join(2000)
      assertFalse(worker.isAlive); assertNull(error.get())
      assertTrue(discarded.get()); assertFalse(saved.get())
    } finally { commit.countDown(); worker.join(2000) }
  }

  @Test fun completionOwnsLockUntilSavedIsAcknowledgedBeforeLaterCancel() {
    val lock = Any(); var stopped = false; var current = true
    val inAcknowledgement = CountDownLatch(1); val cancelReady = CountDownLatch(1); val acknowledge = CountDownLatch(1)
    val saved = AtomicBoolean(false); val cancelledExisting = AtomicBoolean(false)
    val error = AtomicReference<Throwable?>(null)
    val completion = thread {
      try {
        commitDocumentCopy(lock, { stopped }) {
          assertTrue(Thread.holdsLock(lock))
          inAcknowledgement.countDown(); check(acknowledge.await(2, TimeUnit.SECONDS))
          current = false; saved.set(true)
        }
      } catch (failure: Throwable) { error.set(failure) }
    }
    val cancellation = thread {
      try {
        check(inAcknowledgement.await(2, TimeUnit.SECONDS)); cancelReady.countDown()
        synchronized(lock) { if (current) { stopped = true; cancelledExisting.set(true) } }
      } catch (failure: Throwable) { error.set(failure) }
    }
    try {
      assertTrue(cancelReady.await(2, TimeUnit.SECONDS)); acknowledge.countDown()
      completion.join(2000); cancellation.join(2000)
      assertFalse(completion.isAlive); assertFalse(cancellation.isAlive); assertNull(error.get())
      assertTrue(saved.get()); assertFalse(cancelledExisting.get())
    } finally { acknowledge.countDown(); completion.join(2000); cancellation.join(2000) }
  }

  @Test fun destructionTakesPickerBeforeLaunchErrorSoOnlyDestructionSettles() {
    val lock = Any(); val promise = Any(); val picker = PickerPromiseOwner(promise)
    val registered = CountDownLatch(1); val throwLaunch = CountDownLatch(1)
    var settlements = 0; var retirements = 0
    val error = AtomicReference<Throwable?>(null)
    val launch = thread {
      try {
        registered.countDown(); check(throwLaunch.await(2, TimeUnit.SECONDS))
        if (takePickerLaunchFailure(lock, picker, promise) { retirements++ }) settlements++
      } catch (failure: Throwable) { error.set(failure) }
    }
    try {
      assertTrue(registered.await(2, TimeUnit.SECONDS))
      synchronized(lock) { picker.take()?.let { settlements++ } }
      throwLaunch.countDown(); launch.join(2000)
      assertFalse(launch.isAlive); assertNull(error.get())
      assertEquals(1, settlements); assertEquals(0, retirements)
      synchronized(lock) { assertFalse(picker.hasPending()); assertNull(picker.take()) } // Late callback.
    } finally { throwLaunch.countDown(); launch.join(2000) }
  }

  @Test fun launchErrorTakesPickerBeforeDestructionAndLateCallback() {
    val lock = Any(); val promise = Any(); val picker = PickerPromiseOwner(promise)
    val failureOwned = CountDownLatch(1); val completeFailure = CountDownLatch(1)
    var settlements = 0; var retired = false
    val error = AtomicReference<Throwable?>(null)
    val launch = thread {
      try {
        val owned = takePickerLaunchFailure(lock, picker, promise) { retired = true }
        assertTrue(owned); failureOwned.countDown(); check(completeFailure.await(2, TimeUnit.SECONDS))
        if (owned) settlements++
      } catch (failure: Throwable) { error.set(failure) }
    }
    try {
      assertTrue(failureOwned.await(2, TimeUnit.SECONDS))
      synchronized(lock) { assertNull(picker.take()); assertNull(picker.take(promise)) }
      completeFailure.countDown(); launch.join(2000)
      assertFalse(launch.isAlive); assertNull(error.get()); assertTrue(retired); assertEquals(1, settlements)
    } finally { completeFailure.countDown(); launch.join(2000) }
  }

  @Test fun validationFailureBeforeRegistrationStillOwnsOriginalPromise() {
    var retired = false
    assertTrue(takePickerLaunchFailure(Any(), null, Any()) { retired = true })
    assertFalse(retired)
  }

  @Test fun aDifferentPromiseCannotConsumeOrRetireTheOwnedPicker() {
    val promise = Any(); val picker = PickerPromiseOwner(promise); val lock = Any()
    var retired = false
    assertFalse(takePickerLaunchFailure(lock, picker, Any()) { retired = true })
    synchronized(lock) { assertSame(promise, picker.take()); assertFalse(picker.hasPending()) }
    assertFalse(retired)
  }
}
