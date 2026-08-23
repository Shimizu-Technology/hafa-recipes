import AppIntents

@available(iOS 17.0, *)
struct SetGroceryItemCheckedIntent: AppIntent {
  static var title: LocalizedStringResource = "Update Grocery Item"
  static var description = IntentDescription("Marks a Håfa Recipes grocery item checked or unchecked.")
  static var openAppWhenRun = false

  @Parameter(title: "List ID")
  var listID: String

  @Parameter(title: "Item ID")
  var itemID: String

  @Parameter(title: "Checked")
  var checked: Bool

  init() {
    listID = ""
    itemID = ""
    checked = false
  }

  init(listID: String, itemID: String, checked: Bool) {
    self.listID = listID
    self.itemID = itemID
    self.checked = checked
  }

  func perform() async throws -> some IntentResult {
    guard !listID.isEmpty, !itemID.isEmpty else { return .result() }
    await HafaWidgetSyncClient.shared.setChecked(
      listID: listID,
      itemID: itemID,
      checked: checked
    )
    return .result()
  }
}
