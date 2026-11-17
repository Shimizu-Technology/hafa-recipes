import Foundation

struct HafaWidgetSection: Identifiable, Hashable {
  let key: String
  let title: String
  let recipeID: String?
  var items: [HafaWidgetItem]

  var id: String { key }
  var isOtherItems: Bool { key == HafaWidgetSections.otherItemsKey }
  /// Matches the app's grocery section header, which shortens "Other Items".
  var displayTitle: String { isOtherItems ? "Other" : title }
}

/// Mirrors `groupGroceryItems` in `mobile/lib/grocerySections.ts` so the widget
/// and the app list recipes in the same order.
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
