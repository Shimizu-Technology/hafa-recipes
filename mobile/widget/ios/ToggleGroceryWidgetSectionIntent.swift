import AppIntents

@available(iOS 17.0, *)
struct ToggleGroceryWidgetSectionIntent: AppIntent {
  static var title: LocalizedStringResource = "Expand or Collapse Grocery Group"
  static var description = IntentDescription("Shows or hides one Håfa Recipes grocery group.")
  static var openAppWhenRun = false

  @Parameter(title: "List ID")
  var listID: String

  @Parameter(title: "Section Key")
  var sectionKey: String

  @Parameter(title: "Widget Family")
  var familyKey: String

  @Parameter(title: "Page Size")
  var pageSize: Int

  init() {
    listID = ""
    sectionKey = ""
    familyKey = ""
    pageSize = 2
  }

  init(listID: String, sectionKey: String, familyKey: String, pageSize: Int) {
    self.listID = listID
    self.sectionKey = sectionKey
    self.familyKey = familyKey
    self.pageSize = pageSize
  }

  func perform() async throws -> some IntentResult {
    guard !listID.isEmpty,
          !sectionKey.isEmpty,
          HafaWidgetPaging.supports(pageSize: pageSize, for: familyKey) else {
      return .result()
    }
    try HafaWidgetStore.shared.mutateState { state in
      guard let snapshot = state.snapshot, snapshot.list.id == listID else {
        throw HafaWidgetError.missingSession
      }
      let sections = HafaWidgetSections.build(from: snapshot.items)
      guard sections.contains(where: { $0.key == sectionKey }) else {
        throw HafaWidgetError.invalidResponse
      }

      var collapsed = Set(state.collapsedSectionKeys ?? [])
      if collapsed.contains(sectionKey) {
        collapsed.remove(sectionKey)
      } else {
        collapsed.insert(sectionKey)
      }
      state.collapsedSectionKeys = collapsed.sorted()
      state.pageOffsets = nil

      let pages = HafaWidgetSections.pages(
        sections: sections,
        collapsedKeys: collapsed,
        pageSize: pageSize
      )
      let sectionPage = pages.firstIndex { rows in
        rows.contains { row in
          guard case let .section(section, _) = row else { return false }
          return section.key == sectionKey
        }
      } ?? 0
      var indices = state.pageIndices ?? [:]
      indices[familyKey] = sectionPage
      state.pageIndices = indices
      state.markTimelineCacheFresh()
    }
    return .result()
  }
}
