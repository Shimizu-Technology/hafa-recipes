import Foundation

enum HafaWidgetPaging {
  static let mediumFamily = "systemMedium"
  static let largeFamily = "systemLarge"

  static func pageSize(for familyKey: String, accessibilitySize: Bool = false) -> Int? {
    switch familyKey {
    case mediumFamily: return accessibilitySize ? 3 : 4
    case largeFamily: return accessibilitySize ? 6 : 8
    default: return nil
    }
  }

  static func supports(pageSize: Int, for familyKey: String) -> Bool {
    pageSize == self.pageSize(for: familyKey, accessibilitySize: false)
      || pageSize == self.pageSize(for: familyKey, accessibilitySize: true)
  }

  static func page(
    state: HafaWidgetState,
    familyKey: String,
    pageSize: Int
  ) -> HafaWidgetSectionPage {
    let safePageSize = supports(pageSize: pageSize, for: familyKey) ? pageSize : 2
    return HafaWidgetSections.page(
      state: state,
      familyKey: familyKey,
      pageSize: safePageSize
    )
  }

  static func move(
    state: inout HafaWidgetState,
    familyKey: String,
    pageSize: Int,
    direction: Int
  ) throws {
    guard direction == -1 || direction == 1,
          supports(pageSize: pageSize, for: familyKey),
          state.snapshot != nil else {
      throw HafaWidgetError.invalidResponse
    }
    let current = page(state: state, familyKey: familyKey, pageSize: pageSize)
    var indices = state.pageIndices ?? [:]
    indices[familyKey] = current.moved(by: direction)
    state.pageIndices = indices
    state.pageOffsets = nil
  }
}
