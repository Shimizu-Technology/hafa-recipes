import AppIntents

@available(iOS 17.0, *)
struct ChangeGroceryWidgetPageIntent: AppIntent {
  static var title: LocalizedStringResource = "Browse Grocery Items"
  static var description = IntentDescription("Shows another page of Håfa Recipes grocery items.")
  static var openAppWhenRun = false

  @Parameter(title: "List ID")
  var listID: String

  @Parameter(title: "Widget Family")
  var familyKey: String

  @Parameter(title: "Direction")
  var direction: Int

  @Parameter(title: "Page Size")
  var pageSize: Int

  init() {
    listID = ""
    familyKey = ""
    direction = 1
    pageSize = 1
  }

  init(listID: String, familyKey: String, direction: Int, pageSize: Int) {
    self.listID = listID
    self.familyKey = familyKey
    self.direction = direction
    self.pageSize = pageSize
  }

  func perform() async throws -> some IntentResult {
    guard !listID.isEmpty else { return .result() }
    try HafaWidgetStore.shared.mutateState { state in
      guard state.snapshot?.list.id == listID else {
        throw HafaWidgetError.missingSession
      }
      try HafaWidgetPaging.move(
        state: &state,
        familyKey: familyKey,
        pageSize: pageSize,
        direction: direction
      )
      state.markTimelineCacheFresh()
    }
    return .result()
  }
}
