package com.shimizutechnology.hafadocumentsave

import android.app.Activity
import android.content.Intent
import android.content.ContentResolver
import android.net.Uri
import android.os.CancellationSignal
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
  private class Save(val token: String, val source: File, val resolver: ContentResolver, val requestCode: Int, var picker: Promise?) {
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
          save = Save(token, source, context.contentResolver, request, promise)
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
      synchronized(lock) {
        val save = current?.takeIf { !destroyed && it.requestCode == requestCode && it.picker != null }
          ?: return@OnActivityResult
        val picker = save.picker!!
        save.picker = null
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
          save.uri = uri
          if (save.stopped.get()) {
            save.finishing = true
            io.execute { picker.resolve(discard(save)) }
          } else {
            picker.resolve(result("selected"))
          }
        }
      }
    }

    AsyncFunction("copyToDestination") { token: String, promise: Promise ->
      synchronized(lock) {
        val save = current?.takeIf { !destroyed && it.token == token && it.uri != null && !it.copying && !it.finishing }
        if (save == null) { promise.resolve(result("failed", destroyed)); return@AsyncFunction }
        save.copying = true
        // Submit under the same lock as destruction: selected work cannot fall into a shutdown gap.
        io.execute {
          try {
            require(save.source.canonicalFile == save.source)
            DocumentCopy.copy(save.source.length(), save.stopped::get,
              { FileInputStream(save.source) },
              { documentOutput(requireNotNull(save.resolver.openFileDescriptor(save.uri!!, "w", save.opening))) })
            finish(save)
            promise.resolve(result("saved"))
          } catch (_: Exception) {
            promise.resolve(discard(save, if (save.stopped.get()) "cancelled" else "failed"))
          }
        }
      }
    }

    AsyncFunction("discardDestination") { token: String, promise: Promise ->
      synchronized(lock) {
        val save = current?.takeIf { !destroyed && it.token == token && it.uri != null && !it.copying && !it.finishing }
        if (save == null) { promise.resolve(result("failed", true)); return@AsyncFunction }
        save.finishing = true
        stop(save)
        io.execute { promise.resolve(discard(save)) }
      }
    }

    Function("cancel") { token: String ->
      synchronized(lock) {
        val save = current?.takeIf { it.token == token }
        if (save != null) { stop(save) }
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
        shutdownDocumentExecutor(io) {
          current?.let { save ->
            stop(save)
            save.picker?.resolve(result("failed", true))
            save.picker = null
            if (save.uri != null && !save.copying && !save.finishing) {
              save.finishing = true
              io.execute { discard(save) }
            } else if (save.uri == null) {
              // Expo removes activity listeners and clears the registry during destruction.
              // No future callback can reveal this picker URI; retain only an incomplete outcome.
              current = null
            }
          }
        }
        cancelledBeforeStart.clear()
      }
    }
  }

  private fun discard(save: Save, status: String = "cancelled"): Map<String, Any> {
    val removed = try {
      val uri = save.uri
      uri != null && DocumentsContract.deleteDocument(save.resolver, uri)
    } catch (_: Exception) { false }
    finish(save)
    return result(status, !removed)
  }
  private fun finish(save: Save) {
    synchronized(lock) {
      if (current === save) current = null
    }
  }
  private fun stop(save: Save) {
    save.stopped.set(true)
    try { save.opening.cancel() } catch (_: Exception) { /* Copy checks the cancellation flag too. */ }
  }
  private fun result(status: String, incomplete: Boolean = false): Map<String, Any> =
    mapOf("status" to status, "cleanupIncomplete" to incomplete)

  companion object {
    private val REQUESTS = AtomicInteger(27000)
    private val UUID_PATTERN = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    private val OWNER_PATTERN = Regex("^[A-Za-z0-9_.%~-]{1,1024}$")
  }
}
