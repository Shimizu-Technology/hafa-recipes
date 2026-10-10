package com.shimizutechnology.hafapausedhealth

import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ExerciseSegment
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.metadata.Metadata
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import kotlin.math.abs

class HafaPausedHealthModule : Module() {
  companion object { private val nativeProcessIdentity = java.util.UUID.randomUUID().toString() }
  override fun definition() = ModuleDefinition {
    Name("HafaPausedHealth")
    Function("nativeProcessIdentity") { nativeProcessIdentity }
    AsyncFunction("savePausedWorkout") Coroutine { json: String ->
      val payload = JSONObject(json)
      val id = payload.getString("canonical_session_id")
      val revision = payload.getLong("revision")
      val status = payload.getString("status")
      val start = Instant.parse(payload.getString("started_at"))
      val end = Instant.parse(payload.getString("ended_at"))
      val active = payload.getDouble("active_seconds")
      val type = payload.getInt("activity_type")
      require(Regex("^[A-Za-z0-9_-]{1,100}$").matches(id) && revision > 0 && status in listOf("completed", "partial"))
      require(end > start && active.isFinite() && active > 0 && type in listOf(56, 79, 70, 5, 0))
      val intervals = payload.getJSONArray("active_intervals")
      require(intervals.length() in 1..1000)
      val pauses = mutableListOf<ExerciseSegment>()
      var previous = start
      var total = 0.0
      for (index in 0 until intervals.length()) {
        val interval = intervals.getJSONObject(index)
        val a = Instant.parse(interval.getString("started_at"))
        val b = Instant.parse(interval.getString("ended_at"))
        require(a >= previous && b > a && b <= end)
        if (a > previous) pauses.add(ExerciseSegment(previous, a, ExerciseSegment.EXERCISE_SEGMENT_TYPE_PAUSE))
        total += Duration.between(a, b).toNanos() / 1e9
        previous = b
      }
      if (previous < end) pauses.add(ExerciseSegment(previous, end, ExerciseSegment.EXERCISE_SEGMENT_TYPE_PAUSE))
      require(abs(total - active) <= 1)
      val context = requireNotNull(appContext.reactContext)
      val client = HealthConnectClient.getOrCreate(context)
      val permission = HealthPermission.getWritePermission(ExerciseSessionRecord::class)
      require(permission in client.permissionController.getGrantedPermissions()) { "Allow workout writing in Health Connect first" }
      // One session, explicit PAUSE segments; never turn pause gaps into laps or fabricate calories.
      val record = ExerciseSessionRecord(startTime = start, endTime = end, startZoneOffset = null, endZoneOffset = null,
        exerciseType = type, title = if (status == "partial") "Håfa Workouts — partial session" else "Håfa Workouts",
        segments = pauses, metadata = Metadata.manualEntry(clientRecordId = "hafa-workouts:$id", clientRecordVersion = revision))
      val response = client.insertRecords(listOf(record))
      require(response.recordIdsList.isNotEmpty()) { "The provider did not confirm the saved workout" }
      response.recordIdsList.first()
    }
  }
}
