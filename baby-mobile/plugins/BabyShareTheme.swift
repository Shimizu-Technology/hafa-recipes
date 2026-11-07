import UIKit

// Baby Soft, from components/ui.tsx. The extension can't reach the app's bundle, so the plugin copies in the fonts.
enum BabyShareTheme {
  fileprivate static func colour(_ light: UInt32, _ dark: UInt32) -> UIColor {
    func make(_ hex: UInt32) -> UIColor {
      UIColor(red: CGFloat(hex >> 16 & 255) / 255, green: CGFloat(hex >> 8 & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: 1)
    }
    let lightColour = make(light), darkColour = make(dark)
    return UIColor { $0.userInterfaceStyle == .dark ? darkColour : lightColour }
  }
  private static func font(_ name: String, _ size: CGFloat, _ fallback: UIFont.Weight) -> UIFont {
    UIFont(name: name, size: size) ?? .systemFont(ofSize: size, weight: fallback)
  }
  static let value = HafaShareTheme(
    background: colour(0xF8F3EE, 0x14110F),
    title: colour(0x5A4740, 0xF3E9E2),
    detail: colour(0x725F56, 0xB5A39A),
    action: colour(0x5A4740, 0xEBD7CA),
    onAction: colour(0xF8F3EE, 0x2D2420),
    tile: colour(0xF1DDD3, 0x33251F),
    glyph: colour(0x8E4F3D, 0xE0A894),
    problemTile: colour(0xFBE3DE, 0x3A1F1C),
    problemGlyph: colour(0xB3261E, 0xFF6B61),
    titleFont: font("Newsreader-Medium", 28, .medium),
    detailFont: font("DMSans-Regular", 17, .regular),
    buttonFont: font("DMSans-SemiBold", 17, .semibold),
    brandFont: font("DMSans-Regular", 14, .regular),
    brandName: "Håfa Baby",
    mark: { BabyShareMark() }
  )
  static func content(_ state: BabyShareSheetState) -> HafaShareContent {
    let words = state.words
    let icon: String?
    switch state {
    case .saving, .stillWorking: icon = nil
    case .saved, .organizing: icon = "checkmark"
    case .family: icon = "person.2"
    case .waiting, .notConnected: icon = "iphone"
    case .notSignedIn: icon = "person.crop.circle"
    case .failed: icon = "exclamationmark"
    case .tooBig, .unsupported: icon = "doc"
    case .tooManyPhotos: icon = "photo.on.rectangle"
    case .oneLink, .oneAtATime: icon = "link"
    case .locked: icon = "lock"
    }
    return HafaShareContent(icon: icon, isProblem: state.isProblem, title: words.title, detail: words.detail)
  }
}

// The same stone and moon as components/brand-mark.tsx, on the icon's 1024 grid.
final class BabyShareMark: UIView {
  private static let box = CGRect(x: 270, y: 164, width: 484, height: 700)
  private let stone = BabyShareTheme.colour(0x6E5A50, 0xCDB8AA), deep = BabyShareTheme.colour(0x5A4740, 0xB29C8F), moon = BabyShareTheme.colour(0xC9907E, 0xE7B7A5)
  override init(frame: CGRect) {
    super.init(frame: frame)
    isOpaque = false
    contentMode = .redraw
    NSLayoutConstraint.activate([heightAnchor.constraint(equalToConstant: 20), widthAnchor.constraint(equalToConstant: 14)])
  }
  @available(*, unavailable) required init?(coder: NSCoder) { fatalError("Built in code") }
  override func traitCollectionDidChange(_ previous: UITraitCollection?) {
    super.traitCollectionDidChange(previous)
    setNeedsDisplay()
  }
  override func draw(_ rect: CGRect) {
    guard let context = UIGraphicsGetCurrentContext() else { return }
    context.scaleBy(x: bounds.width / Self.box.width, y: bounds.height / Self.box.height)
    context.translateBy(x: -Self.box.minX, y: -Self.box.minY)
    let crescent = UIBezierPath()
    crescent.addArc(withCenter: CGPoint(x: 500.05, y: 350.02), radius: 146, startAngle: 0.33774, endAngle: -1.66716, clockwise: true)
    crescent.addArc(withCenter: CGPoint(x: 573.97, y: 292.09), radius: 124, startAngle: -2.35952, endAngle: 1.0301, clockwise: false)
    crescent.close()
    crescent.lineWidth = 14
    crescent.lineJoinStyle = .round
    moon.setFill(); moon.setStroke()
    crescent.fill(); crescent.stroke()
    UIBezierPath(ovalIn: CGRect(x: 620, y: 184, width: 60, height: 60)).fill()
    let pillar = UIBezierPath()
    pillar.move(to: CGPoint(x: 418, y: 626))
    pillar.addCurve(to: CGPoint(x: 606, y: 626), controlPoint1: CGPoint(x: 432, y: 572), controlPoint2: CGPoint(x: 592, y: 572))
    pillar.addLine(to: CGPoint(x: 650, y: 788))
    pillar.addCurve(to: CGPoint(x: 606, y: 843), controlPoint1: CGPoint(x: 657, y: 816), controlPoint2: CGPoint(x: 635, y: 843))
    pillar.addLine(to: CGPoint(x: 418, y: 843))
    pillar.addCurve(to: CGPoint(x: 374, y: 788), controlPoint1: CGPoint(x: 389, y: 843), controlPoint2: CGPoint(x: 367, y: 816))
    pillar.close()
    stone.setFill()
    pillar.fill()
    let underside = UIBezierPath()
    underside.move(to: CGPoint(x: 330, y: 554))
    underside.addLine(to: CGPoint(x: 694, y: 554))
    underside.addCurve(to: CGPoint(x: 512, y: 654), controlPoint1: CGPoint(x: 673, y: 612), controlPoint2: CGPoint(x: 604, y: 654))
    underside.addCurve(to: CGPoint(x: 330, y: 554), controlPoint1: CGPoint(x: 420, y: 654), controlPoint2: CGPoint(x: 351, y: 612))
    underside.close()
    deep.setFill()
    underside.fill()
    stone.setFill()
    UIBezierPath(roundedRect: CGRect(x: 290, y: 486, width: 444, height: 94), cornerRadius: 47).fill()
  }
}
