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

  static func pageSize(for familyKey: String) -> Int? {
    switch familyKey {
    case mediumFamily: return 4
    case largeFamily: return 8
    default: return nil
    }
  }

  static func slice(
    state: HafaWidgetState,
    familyKey: String,
    total: Int
  ) -> HafaWidgetPageSlice {
    HafaWidgetPageSlice(
      total: total,
      pageSize: pageSize(for: familyKey) ?? 1,
      requestedOffset: state.pageOffsets?[familyKey] ?? 0
    )
  }

  static func move(
    state: inout HafaWidgetState,
    familyKey: String,
    direction: Int
  ) throws {
    guard direction == -1 || direction == 1,
          let pageSize = pageSize(for: familyKey),
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
