import Foundation

/// A group's title line. Recipe groups fold and unfold when tapped; the
/// "Checked" group does not.
struct HafaWidgetGroupHeader: Hashable {
  let key: String
  let title: String
  /// Unchecked items in the group, shown beside a folded or unfolded title.
  let remaining: Int
  let isCollapsible: Bool
  let isCollapsed: Bool
}

/// One line of the medium or large widget list.
enum HafaWidgetRow: Identifiable, Hashable {
  case header(HafaWidgetGroupHeader)
  case item(HafaWidgetItem)

  var id: String {
    switch self {
    case let .header(header): return "header:\(header.key)"
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
  /// Items in a folded group are not hidden: their header counts them.
  let hiddenUncheckedCount: Int

  var showsOverflow: Bool { hiddenUncheckedCount > 0 }

  /// What is left to buy comes first, grouped by recipe like the app. A
  /// folded group shows only its header and count. Checked items only use
  /// leftover space, newest first, so a mistaken tap can be undone without
  /// paging. Checking an item pulls the next one into view.
  static func make(
    items: [HafaWidgetItem],
    pendingItemIDs: Set<String> = [],
    collapsedKeys: Set<String> = [],
    availableHeight: Double,
    metrics: HafaWidgetRowMetrics,
    showsHeaders: Bool
  ) -> HafaWidgetListLayout {
    let unchecked = items.filter { !$0.checked }
    let sections = HafaWidgetSections.build(from: unchecked)
    // A lone "Other" header adds nothing when there are no recipe groups, so
    // that list cannot fold either. The app follows the same rule.
    let headers = showsHeaders && !(sections.count == 1 && sections[0].isOtherItems)
    func isCollapsed(_ section: HafaWidgetSection) -> Bool {
      headers && collapsedKeys.contains(section.key)
    }
    func header(_ section: HafaWidgetSection) -> HafaWidgetRow {
      .header(HafaWidgetGroupHeader(
        key: section.key,
        title: section.displayTitle,
        remaining: section.items.count,
        isCollapsible: true,
        isCollapsed: isCollapsed(section)
      ))
    }

    let fullCost = sections.reduce(0.0) { cost, section in
      cost + (headers ? metrics.header : 0)
        + (isCollapsed(section) ? 0 : Double(section.items.count) * metrics.item)
    }
    var budget = availableHeight
    let mayOverflow = fullCost > budget + 0.5
    if mayOverflow, let overflow = metrics.overflow { budget -= overflow }

    var rows: [HafaWidgetRow] = []
    // Unchecked items either shown as rows or counted by a folded header.
    var accountedUnchecked = 0
    sectionLoop: for section in sections {
      if isCollapsed(section) {
        guard metrics.header <= budget + 0.5 else { break }
        rows.append(header(section))
        budget -= metrics.header
        accountedUnchecked += section.items.count
        continue
      }
      for (index, item) in section.items.enumerated() {
        let needsHeader = headers && index == 0
        let cost = metrics.item + (needsHeader ? metrics.header : 0)
        guard cost <= budget + 0.5 else { break sectionLoop }
        if needsHeader { rows.append(header(section)) }
        rows.append(.item(item))
        budget -= cost
        accountedUnchecked += 1
      }
    }

    // At the largest text sizes a medium widget may not fit a header and an
    // item. Plain rows beat an empty widget.
    if headers && rows.isEmpty && !unchecked.isEmpty {
      return make(
        items: items,
        pendingItemIDs: pendingItemIDs,
        availableHeight: availableHeight,
        metrics: metrics,
        showsHeaders: false
      )
    }

    if accountedUnchecked == unchecked.count {
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
        if needsHeader {
          rows.append(.header(HafaWidgetGroupHeader(
            key: checkedSectionKey,
            title: "Checked",
            remaining: 0,
            isCollapsible: false,
            isCollapsed: false
          )))
        }
        rows.append(.item(item))
        budget -= cost
      }
    }

    return HafaWidgetListLayout(
      rows: rows,
      hiddenUncheckedCount: unchecked.count - accountedUnchecked
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
