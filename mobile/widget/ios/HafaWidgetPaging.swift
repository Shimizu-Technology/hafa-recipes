import Foundation

struct HafaWidgetPageSlice: Equatable {
  let offset: Int
  let endOffset: Int
  let total: Int
  let pageSize: Int

  init(total: Int, pageSize: Int, requestedOffset: Int) {
    let safeTotal = max(0, total)
    let safePageSize = max(1, pageSize)
    let lastPageOffset = safeTotal == 0
      ? 0
      : ((safeTotal - 1) / safePageSize) * safePageSize
    let clampedOffset = min(max(0, requestedOffset), lastPageOffset)

    self.offset = (clampedOffset / safePageSize) * safePageSize
    self.endOffset = min(safeTotal, self.offset + safePageSize)
    self.total = safeTotal
    self.pageSize = safePageSize
  }

  var canMovePrevious: Bool { offset > 0 }
  var canMoveNext: Bool { endOffset < total }

  func moved(by direction: Int) -> HafaWidgetPageSlice {
    let requestedOffset = direction < 0 ? offset - pageSize : offset + pageSize
    return HafaWidgetPageSlice(
      total: total,
      pageSize: pageSize,
      requestedOffset: requestedOffset
    )
  }
}

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

  static func slice(
    state: HafaWidgetState,
    familyKey: String,
    total: Int,
    pageSize: Int
  ) -> HafaWidgetPageSlice {
    HafaWidgetPageSlice(
      total: total,
      pageSize: supports(pageSize: pageSize, for: familyKey) ? pageSize : 1,
      requestedOffset: state.pageOffsets?[familyKey] ?? 0
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
          let snapshot = state.snapshot else {
      throw HafaWidgetError.invalidResponse
    }
    let current = HafaWidgetPageSlice(
      total: snapshot.items.count,
      pageSize: pageSize,
      requestedOffset: state.pageOffsets?[familyKey] ?? 0
    )
    var offsets = state.pageOffsets ?? [:]
    offsets[familyKey] = current.moved(by: direction).offset
    state.pageOffsets = offsets
  }
}
