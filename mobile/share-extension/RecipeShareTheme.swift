import UIKit

// Recipes "Calm", from constants/Colors.ts. The extension can't reach the app's bundle, so the plugin copies in
// the fonts and the mark.
enum RecipeShareTheme {
  private static let colour = HafaShareTheme.colour
  static let value = HafaShareTheme(
    brandName: "Håfa Recipes",
    mark: UIImage(named: "HafaMark.png"),
    card: colour(0xFFFFFF, 0x1A1D1C, (1, 1)),
    surface: colour(0xF7F7F5, 0x232725, (1, 1)),
    ink: colour(0x222222, 0xECEEEC, (1, 1)),
    secondary: colour(0x6A6A66, 0x9BA19E, (1, 1)),
    hairline: colour(0xDCDCD7, 0x353A38, (1, 1)),
    accent: colour(0x145E52, 0x1B7466, (1, 1)),
    onAccent: colour(0xFFFFFF, 0xFFFFFF, (1, 1)),
    accentText: colour(0x145E52, 0x8CCFBE, (1, 1)),
    accentSoft: colour(0x17695B, 0x8CCFBE, (0.08, 0.12)),
    problem: colour(0xB42318, 0xFF7A6E, (1, 1)),
    problemSoft: colour(0xB42318, 0xFF7A6E, (0.10, 0.14)),
    regular: "Figtree-Regular", strong: "Figtree-SemiBold", display: "Fraunces-Medium"
  )
}
