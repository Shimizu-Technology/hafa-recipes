import Foundation

struct HafaWidgetSection: Identifiable, Hashable {
  let key: String
  let title: String
  let recipeID: String?
  var items: [HafaWidgetItem]

  var id: String { key }
  var checkedCount: Int { items.filter(\.checked).count }
  var isOtherItems: Bool { key == HafaWidgetSections.otherItemsKey }
}

enum HafaWidgetDisplayRow: Identifiable, Hashable {
  case section(HafaWidgetSection, continuation: Bool)
  case item(sectionKey: String, HafaWidgetItem)

  var id: String {
    switch self {
    case let .section(section, continuation):
      return "section:\(section.key):\(continuation ? "continued" : "start")"
    case let .item(sectionKey, item):
      return "item:\(sectionKey):\(item.id)"
    }
  }
}

struct HafaWidgetSectionPage: Equatable {
  let index: Int
  let totalPages: Int
  let pageSize: Int
  let rows: [HafaWidgetDisplayRow]

  var canMovePrevious: Bool { index > 0 }
  var canMoveNext: Bool { index + 1 < totalPages }

  func moved(by direction: Int) -> Int {
    min(max(0, index + (direction < 0 ? -1 : 1)), max(0, totalPages - 1))
  }
}

enum HafaWidgetSections {
  static let otherItemsKey = "other-items"
  static let otherItemsTitle = "Other Items"
  private static let comparisonLocale = Locale(identifier: "en_US_POSIX")

  static func build(from items: [HafaWidgetItem]) -> [HafaWidgetSection] {
    var recipeSections: [String: HafaWidgetSection] = [:]
    var otherItems: [HafaWidgetItem] = []

    for item in items {
      guard let key = sectionKey(for: item) else {
        otherItems.append(item)
        continue
      }
      if recipeSections[key] != nil {
        recipeSections[key]?.items.append(item)
      } else {
        recipeSections[key] = HafaWidgetSection(
          key: key,
          title: normalizedTitle(item.recipeTitle) ?? "Recipe Items",
          recipeID: normalizedTitle(item.recipeID),
          items: [item]
        )
      }
    }

    var result = recipeSections.values.sorted { left, right in
      let titleOrder = left.title.compare(
        right.title,
        options: [.caseInsensitive, .diacriticInsensitive, .numeric],
        range: nil,
        locale: comparisonLocale
      )
      return titleOrder == .orderedSame ? left.key < right.key : titleOrder == .orderedAscending
    }
    if !otherItems.isEmpty {
      result.append(
        HafaWidgetSection(
          key: otherItemsKey,
          title: otherItemsTitle,
          recipeID: nil,
          items: otherItems
        )
      )
    }
    return result
  }

  static func pages(
    sections: [HafaWidgetSection],
    collapsedKeys: Set<String>,
    pageSize: Int
  ) -> [[HafaWidgetDisplayRow]] {
    let capacity = max(2, pageSize)
    var pages: [[HafaWidgetDisplayRow]] = []
    var current: [HafaWidgetDisplayRow] = []

    func flush() {
      guard !current.isEmpty else { return }
      pages.append(current)
      current = []
    }

    for section in sections {
      if collapsedKeys.contains(section.key) || section.items.isEmpty {
        if current.count == capacity { flush() }
        current.append(.section(section, continuation: false))
        continue
      }

      // Never leave an expanded section header orphaned at the bottom of a page.
      if current.count > capacity - 2 { flush() }
      current.append(.section(section, continuation: false))

      for item in section.items {
        if current.count == capacity {
          flush()
          current.append(.section(section, continuation: true))
        }
        current.append(.item(sectionKey: section.key, item))
      }
    }
    flush()
    return pages.isEmpty ? [[]] : pages
  }

  static func page(
    state: HafaWidgetState,
    familyKey: String,
    pageSize: Int
  ) -> HafaWidgetSectionPage {
    let sections = build(from: state.snapshot?.items ?? [])
    let allPages = pages(
      sections: sections,
      collapsedKeys: Set(state.collapsedSectionKeys ?? []),
      pageSize: pageSize
    )
    let legacyIndex = (state.pageOffsets?[familyKey] ?? 0) / max(1, pageSize)
    let requestedIndex = state.pageIndices?[familyKey] ?? legacyIndex
    let index = min(max(0, requestedIndex), allPages.count - 1)
    return HafaWidgetSectionPage(
      index: index,
      totalPages: allPages.count,
      pageSize: pageSize,
      rows: allPages[index]
    )
  }

  private static func sectionKey(for item: HafaWidgetItem) -> String? {
    if let recipeID = normalizedTitle(item.recipeID) {
      return "recipe:\(recipeID)"
    }
    guard let title = normalizedTitle(item.recipeTitle) else { return nil }
    let normalized = title.precomposedStringWithCompatibilityMapping
    return "recipe-title:\(normalized.lowercased(with: comparisonLocale))"
  }

  private static func normalizedTitle(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
          !trimmed.isEmpty else { return nil }
    return trimmed
  }
}
