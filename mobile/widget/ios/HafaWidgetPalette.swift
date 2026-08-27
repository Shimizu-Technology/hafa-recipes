import SwiftUI
import WidgetKit

/// The widget runs outside React Native, so it cannot consume `Colors.ts`.
/// Keep these values aligned with the app's island-modern pantry palette and
/// choose appearance-specific roles here instead of using fixed foregrounds.
struct HafaWidgetPalette {
  let colorScheme: ColorScheme
  let contrast: ColorSchemeContrast
  let renderingMode: WidgetRenderingMode

  private var isDark: Bool { colorScheme == .dark }
  private var isHighContrast: Bool { contrast == .increased }
  private var isFullColor: Bool { renderingMode == .fullColor }

  var background: Color {
    guard isFullColor else { return .clear }
    return isDark
      ? Color(red: 0.063, green: 0.078, blue: 0.067) // #101411
      : Color(red: 1.000, green: 0.969, blue: 0.925) // #FFF7EC
  }

  /// Dark mode uses a brighter reef tone for clarity; light mode uses deep
  /// reef so small labels retain accessible contrast on the warm background.
  var accent: Color {
    guard isFullColor else { return .primary }
    if isDark {
      return isHighContrast
        ? Color(red: 0.549, green: 0.847, blue: 0.800) // #8CD8CC
        : Color(red: 0.412, green: 0.784, blue: 0.729) // #69C8BA
    }
    return isHighContrast
      ? Color(red: 0.059, green: 0.286, blue: 0.259) // #0F4942
      : Color(red: 0.082, green: 0.361, blue: 0.322) // #155C52
  }

  var onAccent: Color {
    guard isFullColor else { return .primary }
    return isDark
      ? Color(red: 0.090, green: 0.071, blue: 0.055) // brand ink
      : .white
  }

  /// Filled controls need their own pair of roles. In tinted and accented
  /// rendering modes, using `.primary` for both the fill and its glyph would
  /// erase the glyph, so the system-colored variant becomes a soft neutral
  /// surface with a readable primary foreground.
  var prominentControlBackground: Color {
    isFullColor ? accent : Color.primary.opacity(isHighContrast ? 0.24 : 0.14)
  }

  var prominentControlForeground: Color {
    isFullColor ? onAccent : .primary
  }

  var sectionSurface: Color {
    if !isFullColor {
      return Color.primary.opacity(isHighContrast ? 0.16 : 0.09)
    }
    return isDark
      ? Color(red: 0.125, green: 0.157, blue: 0.125) // #202820
      : Color(red: 0.973, green: 0.937, blue: 0.890) // #F8EFE3
  }

  var controlSurface: Color {
    if !isFullColor {
      return Color.primary.opacity(isHighContrast ? 0.18 : 0.10)
    }
    return isDark
      ? Color(red: 0.173, green: 0.208, blue: 0.184) // #2C352F
      : Color(red: 0.910, green: 0.847, blue: 0.784) // #E8D8C8
  }

  var subtleBorder: Color {
    Color.primary.opacity(isHighContrast ? 0.30 : 0.09)
  }
}
