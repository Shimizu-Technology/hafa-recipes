package com.shimizutechnology.hafadocumentsave

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues
import java.io.File
import java.io.FileInputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class HafaDocumentSaveModule : Module() {
  private class Save(val token: String, val source: File, val requestCode: Int, var picker: Promise?) {
    val stopped = AtomicBoolean(false)
    val opening = CancellationSignal()
    var uri: Uri? = null
    var copying = false
    var finishing = false
  }
  private val lock = Any()
  private var current: Save? = null
  private var destroyed = false
  private val cancelledBeforeStart = LinkedHashSet<String>()
  private val io = Executors.newSingleThreadExecutor()

  override fun definition() = ModuleDefinition {
    Name("HafaDocumentSave")
    AsyncFunction("chooseDestination") { token: String, sourceId: String, ownerScope: String, promise: Promise ->
      val context = appContext.reactContext
      var save: Save? = null
      try {
        require(UUID_PATTERN.matches(token) && UUID_PATTERN.matches(sourceId))
        require(OWNER_PATTERN.matches(ownerScope) && ownerScope !in listOf(".", ".."))
        requireNotNull(context)
        val root = File(context.cacheDir, "hafa-workouts-private-exports").canonicalFile
        val folder = File(root, ownerScope).canonicalFile
        require(folder.parentFile == root)
        val source = File(folder, "hafa-workouts-export-$sourceId.json").canonicalFile
        require(source.parentFile == folder && source.name == "hafa-workouts-export-$sourceId.json")
        require(source.isFile && source.length() in 1..DocumentCopy.MAX_BYTES)
        synchronized(lock) {
          if (cancelledBeforeStart.remove(token)) { promise.resolve(result("cancelled")); return@AsyncFunction }
          if (destroyed || current != null) { promise.resolve(result("failed")); return@AsyncFunction }
          // Unique across module recreation: a late picker result cannot select a newer operation.
          val request = REQUESTS.getAndIncrement()
          require(request <= 65535)
          save = Save(token, source, request, promise)
          current = save
        }
        // Android's documented ACTION_CREATE_DOCUMENT contract creates a NEW document and
        // cannot overwrite an existing file (collisions receive a numbered name).
        // https://developer.android.com/training/data-storage/shared/documents-files#create-file
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          type = "application/json"
          putExtra(Intent.EXTRA_TITLE, "hafa-workouts-export.json")
          addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        appContext.throwingActivity.startActivityForResult(intent, save!!.requestCode)
      } catch (_: Exception) {
        synchronized(lock) { if (current === save) current = null }
        promise.resolve(result("failed"))
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, (requestCode, resultCode, intent) ->
      val save = synchronized(lock) { current?.takeIf { it.requestCode == requestCode && it.picker != null } }
        ?: return@OnActivityResult
      val picker = synchronized(lock) { save.picker.also { save.picker = null } } ?: return@OnActivityResult
      val uri = intent?.data
      // Only a successful result from OUR create-document request establishes ownership.
      val created = try {
        resultCode == Activity.RESULT_OK && uri?.scheme == "content" &&
          appContext.reactContext?.let { DocumentsContract.isDocumentUri(it, uri) } == true
      } catch (_: Exception) { false }
      if (!created) {
        finish(save)
        picker.resolve(result(if (resultCode == Activity.RESULT_CANCELED && uri == null) "cancelled" else "failed",
          resultCode == Activity.RESULT_OK || uri != null))
      } else {
        synchronized(lock) { save.uri = uri }
        if (save.stopped.get()) {
          io.execute { picker.resolve(discard(save)) }
        } else {
          picker.resolve(result("selected"))
        }
      }
    }

    AsyncFunction("copyToDestination") { token: String, promise: Promise ->
      val save = synchronized(lock) {
        current?.takeIf { it.token == token && it.uri != null && !it.copying && !it.finishing }?.also { it.copying = true }
      }
      if (save == null) { promise.resolve(result("failed")); return@AsyncFunction }
      io.execute {
        try {
          val resolver = requireNotNull(appContext.reactContext).contentResolver
          require(save.source.canonicalFile == save.source)
          DocumentCopy.copy(save.source.length(), save.stopped::get,
            { FileInputStream(save.source) },
            {
              val descriptor = requireNotNull(resolver.openFileDescriptor(save.uri!!, "w", save.opening))
              ParcelFileDescriptor.AutoCloseOutputStream(descriptor)
            })
          finish(save)
          promise.resolve(result("saved"))
        } catch (_: Exception) {
          promise.resolve(discard(save, if (save.stopped.get()) "cancelled" else "failed"))
        }
      }
    }

    AsyncFunction("discardDestination") { token: String, promise: Promise ->
      val save = synchronized(lock) {
        current?.takeIf { it.token == token && it.uri != null && !it.copying && !it.finishing }?.also { it.finishing = true }
      }
      if (save == null) { promise.resolve(result("failed", true)); return@AsyncFunction }
      save.stopped.set(true)
      io.execute { promise.resolve(discard(save)) }
    }

    Function("cancel") { token: String ->
      synchronized(lock) {
        val save = current?.takeIf { it.token == token }
        if (save != null) { save.stopped.set(true); save.opening.cancel() }
        else if (UUID_PATTERN.matches(token)) {
          // Covers cancellation racing the queued chooseDestination call. Never start a second picker.
          cancelledBeforeStart.add(token)
          if (cancelledBeforeStart.size > 32) cancelledBeforeStart.remove(cancelledBeforeStart.first())
        }
      }
    }
    OnDestroy {
      synchronized(lock) {
        destroyed = true
        current?.let { save ->
          save.stopped.set(true); save.opening.cancel()
          save.picker?.resolve(result("failed", true))
          // A picker still outstanding retains its slot until its matching callback. Process death
          // can lose this callback/URI; never assert that an empty/partial document was removed.
          if (save.uri != null && !save.copying && !save.finishing) {
            save.finishing = true
            io.execute { discard(save) }
          }
        }
        if (current == null) io.shutdown()
      }
      // Running I/O or a late picker callback still owns close/cleanup; finish releases the executor.
    }
  }

  private fun discard(save: Save, status: String = "cancelled"): Map<String, Any> {
    val removed = try {
      val context = appContext.reactContext
      val uri = save.uri
      context != null && uri != null && DocumentsContract.deleteDocument(context.contentResolver, uri)
    } catch (_: Exception) { false }
    finish(save)
    return result(status, !removed)
  }
  private fun finish(save: Save) {
    synchronized(lock) {
      if (current === save) current = null
      if (destroyed && current == null) io.shutdown()
    }
  }
  private fun result(status: String, incomplete: Boolean = false): Map<String, Any> =
    mapOf("status" to status, "cleanupIncomplete" to incomplete)

  companion object {
    private val REQUESTS = AtomicInteger(27000)
    private val UUID_PATTERN = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    private val OWNER_PATTERN = Regex("^[A-Za-z0-9_.%~-]{1,1024}$")
  }
}
