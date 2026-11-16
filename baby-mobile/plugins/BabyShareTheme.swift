import UIKit

// Baby "Soft", from components/ui.tsx: cocoa for the action and the chosen chip, sand tiles behind the rest, blush and deep
// clay for what's selected. The extension can't reach the app's bundle, so the plugin copies in the fonts and the mark.
enum BabyShareTheme {
  private static let colour = HafaShareTheme.colour
  static let value = HafaShareTheme(
    brandName: "Håfa Baby",
    mark: UIImage(named: "HafaMark.png"),
    card: colour(0xFFFDFB, 0x1C1714, (1, 1)),
    surface: colour(0xF3E9E1, 0x2A221F, (1, 1)),
    ink: colour(0x5A4740, 0xF3E9E2, (1, 1)),
    secondary: colour(0x725F56, 0xB5A39A, (1, 1)),
    hairline: colour(0xE6D9CE, 0x3A302B, (1, 1)),
    accent: colour(0x5A4740, 0xEBD7CA, (1, 1)),
    onAccent: colour(0xF8F3EE, 0x2D2420, (1, 1)),
    accentText: colour(0x8E4F3D, 0xE0A894, (1, 1)),
    accentSoft: colour(0xF1DDD3, 0x3A2A23, (1, 1)),
    problem: colour(0xB3261E, 0xFF6B61, (1, 1)),
    problemSoft: colour(0xFBE3DE, 0x3A1F1C, (1, 1)),
    regular: "DMSans-Regular", strong: "DMSans-SemiBold", display: "Newsreader-Medium"
  )
}
