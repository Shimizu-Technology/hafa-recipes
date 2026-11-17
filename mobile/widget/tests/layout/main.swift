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
    case let .header(_, title): return "# \(title)"
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
  ["# Lasagna My Way", "o Tony's seasoning", "o cumin", "# Other", "o onion",
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
expect(describe(tight), ["# Adobo", "o a"], "no orphaned header")
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

print("Grocery widget layout fixtures passed")
