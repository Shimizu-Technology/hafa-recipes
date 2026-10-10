import ExpoModulesCore

public final class HafaPausedHealthModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HafaPausedHealth")
    AsyncFunction("savePausedWorkout") { (payload: String, promise: Promise) in
      Task {
        do { promise.resolve(try await PausedHealthWriter().save(payload)) }
        catch { promise.reject("health_write_failed", "The provider could not confirm this workout. Your app record is preserved.") }
      }
    }
  }
}
