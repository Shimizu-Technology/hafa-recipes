import AppIntents

/// Folds or unfolds one recipe's items on the widget. The fold is display
/// state in the app group, shared with the app; it never reaches the server.
@available(iOS 17.0, *)
struct ToggleGrocerySectionIntent: AppIntent {
  static var title: LocalizedStringResource = "Show or Hide Recipe Items"
  static var description = IntentDescription("Folds or unfolds a recipe's items on the Håfa Recipes grocery widget.")
  static var openAppWhenRun = false
  static var isDiscoverable = false

  @Parameter(title: "Account")
  var accountScopeID: String

  @Parameter(title: "List ID")
  var listID: String

  @Parameter(title: "Section")
  var sectionKey: String

  init() {
    accountScopeID = ""
    listID = ""
    sectionKey = ""
  }

  init(accountScopeID: String, listID: String, sectionKey: String) {
    self.accountScopeID = accountScopeID
    self.listID = listID
    self.sectionKey = sectionKey
  }

  func perform() async throws -> some IntentResult {
    guard !accountScopeID.isEmpty, !listID.isEmpty, !sectionKey.isEmpty else { return .result() }
    try HafaWidgetStore.shared.toggleCollapsedSection(accountScopeID: accountScopeID, listID: listID, key: sectionKey)
    return .result()
  }
}
