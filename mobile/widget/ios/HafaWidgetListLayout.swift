import Foundation

/// One line of the medium or large widget list.
enum HafaWidgetRow: Identifiable, Hashable {
  case header(key: String, title: String)
  case item(HafaWidgetItem)

  var id: String {
    switch self {
    case let .header(key, _): return "header:\(key)"
    case let .item(item): return "item:\(item.id)"
    }
  }
}

/// Point heights for each kind of row. The view scales them with Dynamic Type
/// before asking for a layout, so the list never overflows the widget.
struct HafaWidgetRowMetrics: Equatable {
  var item: Double
  var header: Double
  /// Height of the "N more" line, or nil to leave it out.
  var overflow: Double?
}

struct HafaWidgetListLayout: Equatable {
  static let checkedSectionKey = "checked"

  let rows: [HafaWidgetRow]
  /// Unchecked items that did not fit and are only reachable in the app.
  let hiddenUncheckedCount: Int

  var showsOverflow: Bool { hiddenUncheckedCount > 0 }

  /// What is left to buy comes first, grouped by recipe like the app. Checked
  /// items only use leftover space, newest first, so a mistaken tap can be
  /// undone without paging. Checking an item pulls the next one into view.
  static func make(
    items: [HafaWidgetItem],
    pendingItemIDs: Set<String> = [],
    availableHeight: Double,
    metrics: HafaWidgetRowMetrics,
    showsHeaders: Bool
  ) -> HafaWidgetListLayout {
    let unchecked = items.filter { !$0.checked }
    let sections = HafaWidgetSections.build(from: unchecked)
    // A lone "Other" header adds nothing when there are no recipe groups.
    let headers = showsHeaders && !(sections.count == 1 && sections[0].isOtherItems)

    let fullCost = Double(unchecked.count) * metrics.item
      + (headers ? Double(sections.count) * metrics.header : 0)
    var budget = availableHeight
    let mayOverflow = fullCost > budget + 0.5
    if mayOverflow, let overflow = metrics.overflow { budget -= overflow }

    var rows: [HafaWidgetRow] = []
    var shownUnchecked = 0
    sectionLoop: for section in sections {
      for (index, item) in section.items.enumerated() {
        let needsHeader = headers && index == 0
        let cost = metrics.item + (needsHeader ? metrics.header : 0)
        guard cost <= budget + 0.5 else { break sectionLoop }
        if needsHeader { rows.append(.header(key: section.key, title: section.displayTitle)) }
        rows.append(.item(item))
        budget -= cost
        shownUnchecked += 1
      }
    }

    if shownUnchecked == unchecked.count {
      let checked = items.filter(\.checked).sorted { left, right in
        let leftPending = pendingItemIDs.contains(left.id)
        if leftPending != pendingItemIDs.contains(right.id) { return leftPending }
        if left.updatedAt != right.updatedAt { return left.updatedAt > right.updatedAt }
        return left.id < right.id
      }
      for (index, item) in checked.enumerated() {
        let needsHeader = headers && index == 0
        let cost = metrics.item + (needsHeader ? metrics.header : 0)
        guard cost <= budget + 0.5 else { break }
        if needsHeader { rows.append(.header(key: checkedSectionKey, title: "Checked")) }
        rows.append(.item(item))
        budget -= cost
      }
    }

    return HafaWidgetListLayout(
      rows: rows,
      hiddenUncheckedCount: unchecked.count - shownUnchecked
    )
  }

  /// The small widget shows a short preview of what is left, in list order.
  static func preview(items: [HafaWidgetItem], limit: Int) -> [HafaWidgetItem] {
    let unchecked = items.filter { !$0.checked }
    return Array(HafaWidgetSections.build(from: unchecked).flatMap(\.items).prefix(max(0, limit)))
  }
}

extension HafaWidgetItem {
  /// The amount the app shows beside an item, such as "2 cups".
  var amountText: String? {
    let amount = [quantity, unit]
      .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty && $0 != "null" }
      .joined(separator: " ")
    return amount.isEmpty ? nil : amount
  }
}
