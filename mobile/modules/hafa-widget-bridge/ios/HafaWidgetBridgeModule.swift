import ExpoModulesCore
import Foundation
import WidgetKit

public final class HafaWidgetBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HafaWidgetBridge")

    AsyncFunction("configureSession") {
      (token: String, apiBaseURL: String, snapshotJSON: String) throws in
      try HafaWidgetStore.shared.configureSession(
        token: token,
        apiBaseURL: apiBaseURL,
        snapshotData: Data(snapshotJSON.utf8)
      )
      WidgetCenter.shared.reloadTimelines(ofKind: HafaWidgetConstants.widgetKind)
    }

    AsyncFunction("updateSnapshot") { (snapshotJSON: String) throws in
      try HafaWidgetStore.shared.mergeServerSnapshot(Data(snapshotJSON.utf8))
      WidgetCenter.shared.reloadTimelines(ofKind: HafaWidgetConstants.widgetKind)
    }

    AsyncFunction("getSessionStatus") { () throws -> [String: Any?] in
      let state = try HafaWidgetStore.shared.readState()
      return [
        "available": true,
        "hasCredential": HafaWidgetCredentialStore.shared.read() != nil,
        "accountScopeId": state.accountScopeID,
        "listId": state.snapshot?.list.id,
        "pendingCount": state.pending.count,
        "requiresReconnect": state.requiresReconnect,
      ]
    }

    AsyncFunction("flushPending") {
      await HafaWidgetSyncClient.shared.flushPending()
      WidgetCenter.shared.reloadTimelines(ofKind: HafaWidgetConstants.widgetKind)
    }

    AsyncFunction("clearSession") { (revoke: Bool) async throws -> Bool in
      let revoked: Bool
      if revoke {
        revoked = try await HafaWidgetSyncClient.shared.revokeAndClearSession()
      } else {
        try HafaWidgetStore.shared.clearSession()
        revoked = false
      }
      WidgetCenter.shared.reloadTimelines(ofKind: HafaWidgetConstants.widgetKind)
      return revoked
    }
  }
}
