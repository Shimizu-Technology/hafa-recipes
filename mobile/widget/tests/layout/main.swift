import Foundation

func item(
  _ id: String,
  checked: Bool = false,
  recipe: String? = nil,
  quantity: String? = nil,
  unit: String? = nil,
  updatedAt: String = "2026-11-17T00:00:00Z"
) -> HafaWidgetItem {
  HafaWidgetItem(
    id: id,
    name: id,
    quantity: quantity,
    unit: unit,
    notes: nil,
    checked: checked,
    recipeID: recipe.map { "id-\($0)" },
    recipeTitle: recipe,
    addedByName: nil,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: updatedAt
  )
}

func describe(_ layout: HafaWidgetListLayout) -> [String] {
  layout.rows.map { row in
    switch row {
    case let .header(header):
      guard header.isCollapsible else { return "# \(header.title)" }
      return "\(header.isCollapsed ? ">" : "v") \(header.title) (\(header.remaining))"
    case let .item(item): return item.checked ? "x \(item.id)" : "o \(item.id)"
    }
  }
}

func expect(_ actual: [String], _ expected: [String], _ name: String) {
  precondition(actual == expected, "\(name): expected \(expected), got \(actual)")
}

let large = HafaWidgetRowMetrics(item: 30, header: 24, overflow: 24)
let medium = HafaWidgetRowMetrics(item: 25, header: 24, overflow: nil)

// Leon's list from 2026-11-17: a finished recipe and a mostly finished one.
// What is left comes first; the finished recipe gets no header and done items
// only fill leftover space under "Checked", newest first.
let leonsList = [
  item("Tony's seasoning", recipe: "Lasagna My Way", quantity: "1", unit: "tsp"),
  item("cumin", recipe: "Lasagna My Way"),
  item("onion"),
  item("Eggplant", checked: true, recipe: "Ground Beef Tinaktak", updatedAt: "2026-11-16T00:00:00Z"),
  item("mozzarella", checked: true, recipe: "Lasagna My Way", updatedAt: "2026-11-17T01:00:00Z"),
  item("garlic powder", checked: true, recipe: "Lasagna My Way", updatedAt: "2026-11-15T00:00:00Z"),
]
expect(
  describe(.make(items: leonsList, availableHeight: 300, metrics: large, showsHeaders: true)),
  ["v Lasagna My Way (2)", "o Tony's seasoning", "o cumin", "v Other (1)", "o onion",
   "# Checked", "x mozzarella", "x Eggplant", "x garlic powder"],
  "unchecked first, grouped like the app, checked newest first"
)

// A pending widget tap counts as the newest check even before the server
// returns a new updated_at.
expect(
  describe(.make(items: leonsList, pendingItemIDs: ["garlic powder"], availableHeight: 300, metrics: large, showsHeaders: true)).suffix(3).map { $0 },
  ["x garlic powder", "x mozzarella", "x Eggplant"],
  "pending checks lead the checked rows"
)

// Medium has no headers and stops when the space runs out.
let mediumLayout = HafaWidgetListLayout.make(items: leonsList, availableHeight: 100, metrics: medium, showsHeaders: false)
expect(describe(mediumLayout), ["o Tony's seasoning", "o cumin", "o onion", "x mozzarella"], "medium fills four rows")
precondition(!mediumLayout.showsOverflow)

// A long list never shows checked rows, reserves the "more" line and counts
// what is hidden. A header is never left without an item beneath it.
let long = (1...12).map { item("a\($0)", recipe: "Adobo") } + [item("done", checked: true)]
let longLayout = HafaWidgetListLayout.make(items: long, availableHeight: 300, metrics: large, showsHeaders: true)
precondition(longLayout.rows.count == 9, "\(describe(longLayout))") // header + 8 items + overflow = 288
precondition(longLayout.hiddenUncheckedCount == 4)
precondition(!describe(longLayout).contains("x done"))
let tight = HafaWidgetListLayout.make(
  items: [item("a", recipe: "Adobo"), item("b", recipe: "Kelaguen")],
  availableHeight: 54 + 24 + 20,
  metrics: large,
  showsHeaders: true
)
expect(describe(tight), ["v Adobo (1)", "o a"], "no orphaned header")
precondition(tight.hiddenUncheckedCount == 1)

// A lone "Other" group needs no header.
expect(
  describe(.make(items: [item("rice"), item("eggs")], availableHeight: 300, metrics: large, showsHeaders: true)),
  ["o rice", "o eggs"],
  "no header for ungrouped items"
)

// All done: checked rows fill the space so the last tap can be undone.
expect(
  describe(.make(items: [item("rice", checked: true)], availableHeight: 100, metrics: medium, showsHeaders: false)),
  ["x rice"],
  "all-checked list still shows recent checks"
)
precondition(HafaWidgetListLayout.make(items: [], availableHeight: 300, metrics: large, showsHeaders: true).rows.isEmpty)

// The small preview follows the list order and skips checked items.
precondition(HafaWidgetListLayout.preview(items: leonsList, limit: 3).map(\.id) == ["Tony's seasoning", "cumin", "onion"])

// Amounts read like the app's secondary line and ignore blanks.
precondition(item("x", quantity: "2", unit: "cups").amountText == "2 cups")
precondition(item("x", quantity: " ", unit: nil).amountText == nil)
precondition(item("x", quantity: "3", unit: "null").amountText == "3")

// Folding: a folded group keeps its header and count, frees its rows for the
// next group, and is not counted as hidden by the "more" line.
let folded = HafaWidgetListLayout.make(
  items: leonsList,
  collapsedKeys: ["recipe:id-Lasagna My Way"],
  availableHeight: 300,
  metrics: large,
  showsHeaders: true
)
expect(
  describe(folded),
  ["> Lasagna My Way (2)", "v Other (1)", "o onion", "# Checked", "x mozzarella", "x Eggplant", "x garlic powder"],
  "folded group shows only its header"
)
precondition(folded.hiddenUncheckedCount == 0)

// Medium groups too, so a group folded anywhere reads the same in medium.
let foldedLong = (1...12).map { item("a\($0)", recipe: "Adobo") } + [item("b1", recipe: "Kelaguen"), item("b2", recipe: "Kelaguen")]
expect(
  describe(.make(items: foldedLong, collapsedKeys: ["recipe:id-Adobo"], availableHeight: 104, metrics: medium, showsHeaders: true)),
  ["> Adobo (12)", "v Kelaguen (2)", "o b1", "o b2"],
  "medium shows the folded group's count and the next group's items"
)
let unfoldedMedium = HafaWidgetListLayout.make(items: foldedLong, availableHeight: 104, metrics: medium, showsHeaders: true)
expect(describe(unfoldedMedium), ["v Adobo (12)", "o a1", "o a2", "o a3"], "medium unfolded fills with the first group")
precondition(unfoldedMedium.hiddenUncheckedCount == 11)

// When every group is folded, recent checks still fill the space for undo.
let allFolded = HafaWidgetListLayout.make(
  items: leonsList,
  collapsedKeys: ["recipe:id-Lasagna My Way", "other-items"],
  availableHeight: 300,
  metrics: large,
  showsHeaders: true
)
expect(Array(describe(allFolded).prefix(3)), ["> Lasagna My Way (2)", "> Other (1)", "# Checked"], "all folded")

// A lone "Other" list has no header, so a stale fold cannot hide it.
expect(
  describe(.make(items: [item("rice")], collapsedKeys: ["other-items"], availableHeight: 300, metrics: large, showsHeaders: true)),
  ["o rice"],
  "ungrouped items ignore a fold"
)

// A folded header that does not fit counts its items as hidden.
let noRoom = HafaWidgetListLayout.make(
  items: [item("a", recipe: "Adobo"), item("b", recipe: "Kelaguen")],
  collapsedKeys: ["recipe:id-Kelaguen"],
  availableHeight: 24 + 30 + 20,
  metrics: HafaWidgetRowMetrics(item: 30, header: 24, overflow: nil),
  showsHeaders: true
)
expect(describe(noRoom), ["v Adobo (1)", "o a"], "folded header needs room too")
precondition(noRoom.hiddenUncheckedCount == 1)

// Too short for a header and an item: plain rows instead of an empty widget.
expect(
  describe(.make(items: foldedLong, availableHeight: 60, metrics: HafaWidgetRowMetrics(item: 40, header: 45, overflow: nil), showsHeaders: true)),
  ["o a1"],
  "header-less fallback at the largest sizes"
)

// Store: the widget toggles a fold for its own list only, records when, and
// an older app copy never overwrites a newer widget fold.
let storeDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try! FileManager.default.createDirectory(at: storeDirectory, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: storeDirectory) }
let store = HafaWidgetStore(directory: storeDirectory)
let storeSnapshot = HafaWidgetSnapshot(
  accountScopeID: "scope",
  list: HafaWidgetList(id: "list-1", name: "Grocery List", isShared: false, revision: 1, createdAt: "", updatedAt: ""),
  items: leonsList, total: leonsList.count, unchecked: 3, checked: 3, serverTime: ""
)
try! store.mutateState { state in
  state.snapshot = storeSnapshot
  // Left by the retired paging widget, without a time.
  state.collapsedSectionKeys = ["recipe:id-Old"]
}
precondition(try! store.readState().currentCollapsedSectionKeys.isEmpty, "untimed keys are ignored")
precondition(try! store.toggleCollapsedSection(listID: "other-list", key: "other-items") == false)
let foldTime = Date(timeIntervalSince1970: 1_000)
precondition(try! store.toggleCollapsedSection(listID: "list-1", key: "recipe:id-Lasagna My Way", now: foldTime))
var foldState = try! store.readState()
precondition(foldState.currentCollapsedSectionKeys == ["recipe:id-Lasagna My Way"])
precondition(foldState.collapsedSectionsUpdatedAt == 1_000_000)
precondition(foldState.shouldUseCachedTimeline(at: foldTime), "a fold redraws from the cache")
precondition(try! store.setCollapsedSections(listID: "list-1", keys: [], updatedAt: 999_999) == false, "older app copy is ignored")
precondition(try! store.setCollapsedSections(listID: "list-1", keys: ["other-items"], updatedAt: 1_000_001))
precondition(try! store.setCollapsedSections(listID: "other-list", keys: [], updatedAt: 2_000_000) == false)
foldState = try! store.readState()
precondition(foldState.currentCollapsedSectionKeys == ["other-items"])
precondition(try! store.toggleCollapsedSection(listID: "list-1", key: "other-items", now: Date(timeIntervalSince1970: 1_001)))
precondition(try! store.readState().currentCollapsedSectionKeys.isEmpty)

print("Grocery widget layout fixtures passed")
