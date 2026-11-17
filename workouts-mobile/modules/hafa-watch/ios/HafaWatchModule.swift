import ExpoModulesCore
@preconcurrency import WatchConnectivity

final class PhoneWatchLink: NSObject, WCSessionDelegate, @unchecked Sendable {
  static let shared = PhoneWatchLink()
  let inbox = WatchInbox(directory: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("hafa-watch/inbox"))
  // All inbox operations use this queue, including JS calls.
  let queue = DispatchQueue(label: "hafa-watch.inbox")
  private let changes = WatchChanges()
  func observe(_ callback: (() -> Void)?) { changes.observe(callback) }
  private var plansURL: URL { inbox.directory.deletingLastPathComponent().appendingPathComponent("outgoing-plans.json") }
  private var plans: WatchPlanCache { WatchPlanCache(url: plansURL) }
  func clearPlans() throws {
    try queue.sync { try plans.clear { try pushPlans() } }
  }
  func setPlans(_ json: String) throws {
    try queue.sync {
      try plans.save(json)
      try pushPlans()
    }
  }
  private func pushPlans() throws {
    guard WCSession.default.activationState == .activated, WCSession.default.isPaired, WCSession.default.isWatchAppInstalled else { return }
    let json = try plans.read()
    try WCSession.default.updateApplicationContext(["plans": json])
  }
  func activate() {
    guard WCSession.isSupported() else { return }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }
  func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
    queue.async { try? self.pushPlans() }
  }
  func sessionWatchStateDidChange(_ session: WCSession) { queue.async { try? self.pushPlans() } }
  func sessionDidBecomeInactive(_ session: WCSession) {}
  func sessionDidDeactivate(_ session: WCSession) { session.activate() }
  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
    guard let json = userInfo["result"] as? String else { return }
    queue.async {
      do {
        let id = try self.inbox.receive(json)
        // Ack only after the atomic durable write. No RN, token or network dependency.
        session.transferUserInfo(["ack": id])
        self.changes.notify()
      } catch { /* Leave the watch outbox intact for a later delivery. */ }
    }
  }
}

public class HafaWatchSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    PhoneWatchLink.shared.activate()
    return true
  }
}

public final class HafaWatchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HafaWatch")
    Events("onResults")
    OnStartObserving { PhoneWatchLink.shared.observe { [weak self] in self?.sendEvent("onResults", [:]) } }
    OnStopObserving { PhoneWatchLink.shared.observe(nil) }
    AsyncFunction("setPlans") { (json: String) in
      guard json.utf8.count < 16 * 1024 else { throw CocoaError(.fileWriteOutOfSpace) }
      try PhoneWatchLink.shared.setPlans(json)
    }
    AsyncFunction("clearPlans") { try PhoneWatchLink.shared.clearPlans() }
    AsyncFunction("purgeResults") { (owner: String, account: String?) in
      try PhoneWatchLink.shared.queue.sync { try PhoneWatchLink.shared.inbox.purge(owner: owner, account: account) }
    }
    AsyncFunction("pendingResults") { () -> [String] in
      try PhoneWatchLink.shared.queue.sync { try PhoneWatchLink.shared.inbox.pending() }
    }
    AsyncFunction("markImported") { (id: String) in
      try PhoneWatchLink.shared.queue.sync { try PhoneWatchLink.shared.inbox.markImported(id) }
    }
  }
}
