import Foundation
import WatchConnectivity

@MainActor final class PhoneLink: NSObject, ObservableObject, @preconcurrency WCSessionDelegate {
  static let shared = PhoneLink()
  @Published var plans = PlanLibrary.plans
  private let outbox = ClassOutbox.standard()
  func activate() {
    guard WCSession.isSupported() else { return }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }
  nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
    let json = session.receivedApplicationContext["plans"] as? String
    Task { @MainActor in self.receive(json); self.flush() }
  }
  nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    let json = applicationContext["plans"] as? String
    Task { @MainActor in self.receive(json) }
  }
  nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
    guard let id = userInfo["ack"] as? String else { return }
    Task { @MainActor in try? self.outbox.acknowledge(id) }
  }
  private func receive(_ json: String?) {
    guard let json, let data = json.data(using: .utf8), data.count < 16 * 1024 else { return }
    do { try PlanLibrary.receive(data); plans = PlanLibrary.plans } catch { /* Keep the last valid context. */ }
  }
  func flush() {
    let session = WCSession.default
    guard session.activationState == .activated else { return }
    let pending = Set(session.outstandingUserInfoTransfers.compactMap { $0.userInfo["id"] as? String })
    for record in outbox.records() {
      let id = record.clientSessionId.uuidString.lowercased()
      if !pending.contains(id), let json = try? record.payload() { session.transferUserInfo(["id": id, "result": json]) }
    }
  }
}
