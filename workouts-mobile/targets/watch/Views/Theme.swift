import SwiftUI

/// Athletic dark roles from constants/theme.ts. The watch is always dark, on a true-black ground.
enum Theme {
  static let background = Color.black
  static let surface = Color(hex: 0x161618)
  static let text = Color(hex: 0xF5F5F2)
  static let muted = Color(hex: 0xB1B1B8)
  /// Coral is for actions and the active state only.
  static let accent = Color(hex: 0xFF7A50)
  static let onAccent = Color(hex: 0x17120F)

  /// Barlow Condensed, the phone's display face, scaled with Dynamic Type.
  static func display(_ size: CGFloat, relativeTo style: Font.TextStyle = .title2) -> Font {
    .custom("BarlowCondensed-Bold", size: size, relativeTo: style)
  }
}

/// One treatment for peers: full-width, 60 pt targets, one-line type, no mixed icon placement.
struct WatchButton: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(.headline, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.7)
      .frame(maxWidth: .infinity, minHeight: 60)
      .foregroundStyle(Theme.onAccent)
      .background(Theme.accent.opacity(configuration.isPressed ? 0.65 : 1),
        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
  }
}

func watchTime(_ seconds: TimeInterval) -> String {
  let value = max(0, Int(seconds.rounded(.up)))
  return String(format: "%d:%02d", value / 60, value % 60)
}

extension Color {
  init(hex: UInt32) {
    self.init(
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255)
  }
}
