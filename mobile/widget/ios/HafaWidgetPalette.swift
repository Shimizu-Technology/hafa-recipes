import SwiftUI
import WidgetKit

/// The widget runs outside React Native, so it cannot consume `Colors.ts`.
/// These values mirror the app's Calm tokens: a white sheet (dark: #1A1D1C),
/// one deep-reef accent and 1pt hairlines. Tinted and clear home screens fall
/// back to system roles so the glyphs stay readable.
struct HafaWidgetPalette {
  let colorScheme: ColorScheme
  let contrast: ColorSchemeContrast
  let renderingMode: WidgetRenderingMode

  private var isDark: Bool { colorScheme == .dark }
  private var isHighContrast: Bool { contrast == .increased }
  private var isFullColor: Bool { renderingMode == .fullColor }

  /// Colors.backgroundElevated: #FFFFFF / #1A1D1C.
  var background: Color {
    guard isFullColor else { return .clear }
    return isDark ? Color(hex: 0x1A1D1C) : Color(hex: 0xFFFFFF)
  }

  /// Colors.text: #222222 / #ECEEEC.
  var text: Color {
    guard isFullColor else { return .primary }
    return isDark ? Color(hex: 0xECEEEC) : Color(hex: 0x222222)
  }

  /// Colors.textSecondary: #6A6A66 / #9BA19E, darker or lighter for
  /// Increase Contrast.
  var secondaryText: Color {
    guard isFullColor else { return .secondary }
    if isDark { return isHighContrast ? Color(hex: 0xC4C9C6) : Color(hex: 0x9BA19E) }
    return isHighContrast ? Color(hex: 0x4A4A46) : Color(hex: 0x6A6A66)
  }

  /// Colors.actionText: checkmarks and links. #145E52 / #8CCFBE.
  var accent: Color {
    guard isFullColor else { return .primary }
    if isDark { return isHighContrast ? Color(hex: 0xB0E2D5) : Color(hex: 0x8CCFBE) }
    return isHighContrast ? Color(hex: 0x0F4942) : Color(hex: 0x145E52)
  }

  /// Colors.tint behind the add button. #17695B / #1B7466 with white.
  /// In tinted modes a filled accent would erase its glyph, so the button
  /// becomes a soft neutral circle with a primary foreground.
  var prominentControlBackground: Color {
    guard isFullColor else { return Color.primary.opacity(isHighContrast ? 0.24 : 0.14) }
    return isDark ? Color(hex: 0x1B7466) : Color(hex: 0x17695B)
  }

  var prominentControlForeground: Color {
    isFullColor ? .white : .primary
  }

  /// Colors.hairline: #E7E7E3 / #2A2E2C.
  var hairline: Color {
    guard isFullColor else { return Color.primary.opacity(isHighContrast ? 0.30 : 0.12) }
    if isHighContrast { return isDark ? Color(hex: 0x4A504D) : Color(hex: 0xC8C8C2) }
    return isDark ? Color(hex: 0x2A2E2C) : Color(hex: 0xE7E7E3)
  }

  /// Colors.warning for a connection problem: #8A5A00 / #E8B04A.
  var warning: Color {
    guard isFullColor else { return .primary }
    return isDark ? Color(hex: 0xE8B04A) : Color(hex: 0x8A5A00)
  }
}

private extension Color {
  init(hex: UInt32) {
    self.init(
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255
    )
  }
}

/// Figtree, the app's UI face, bundled with the extension. Each size scales
/// with Dynamic Type relative to a system style.
enum HafaWidgetFont {
  static func medium(_ size: CGFloat, relativeTo style: Font.TextStyle) -> Font {
    .custom("Figtree-Medium", size: size, relativeTo: style)
  }

  static func semibold(_ size: CGFloat, relativeTo style: Font.TextStyle) -> Font {
    .custom("Figtree-SemiBold", size: size, relativeTo: style)
  }

  static func bold(_ size: CGFloat, relativeTo style: Font.TextStyle) -> Font {
    .custom("Figtree-Bold", size: size, relativeTo: style)
  }
}
