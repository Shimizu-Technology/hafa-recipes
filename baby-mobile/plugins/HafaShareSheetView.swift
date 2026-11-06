import UIKit

// The share sheet's look, with nothing about any one app in it. What it says and how it's dressed come from
// outside, so another Håfa app can use this file unchanged with its own theme.
struct HafaShareTheme {
  let background, title, detail, action, onAction, tile, glyph, problemTile, problemGlyph: UIColor
  let titleFont, detailFont, buttonFont, brandFont: UIFont
  let brandName, doneTitle: String
  let mark: () -> UIView
}

struct HafaShareContent: Equatable {
  let icon: String?
  let isProblem: Bool
  let title: String
  let detail: String?
}

final class HafaShareSheetView: UIView {
  private let theme: HafaShareTheme
  private let tile = UIView(), glyph = UIImageView(), spinner = UIActivityIndicatorView(style: .large)
  private let heading = UILabel(), message = UILabel(), done = UIButton(type: .system), stack = UIStackView()
  var onDone: (() -> Void)?

  init(theme: HafaShareTheme) {
    self.theme = theme
    super.init(frame: .zero)
    backgroundColor = theme.background
    isOpaque = true

    let mark = theme.mark()
    mark.isAccessibilityElement = false
    let brand = UILabel()
    brand.text = theme.brandName
    brand.textColor = theme.detail
    brand.font = Self.scaled(theme.brandFont, .footnote)
    brand.adjustsFontForContentSizeCategory = true
    let brandRow = UIStackView(arrangedSubviews: [mark, brand])
    brandRow.spacing = 7
    brandRow.alignment = .center

    tile.layer.cornerRadius = 24
    tile.layer.cornerCurve = .continuous
    glyph.contentMode = .scaleAspectFit
    glyph.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 30, weight: .regular)
    glyph.translatesAutoresizingMaskIntoConstraints = false
    tile.addSubview(glyph)
    spinner.color = theme.glyph
    spinner.hidesWhenStopped = true

    heading.textColor = theme.title
    heading.font = Self.scaled(theme.titleFont, .title1)
    heading.adjustsFontForContentSizeCategory = true
    heading.numberOfLines = 0
    heading.textAlignment = .center
    heading.accessibilityTraits.insert(.header)
    message.textColor = theme.detail
    message.font = Self.scaled(theme.detailFont, .body)
    message.adjustsFontForContentSizeCategory = true
    message.numberOfLines = 0
    message.textAlignment = .center
    message.lineBreakStrategy = [.standard, .pushOut]

    stack.axis = .vertical
    stack.alignment = .center
    [tile, spinner, heading, message].forEach { stack.addArrangedSubview($0) }
    stack.setCustomSpacing(20, after: tile)
    stack.setCustomSpacing(20, after: spinner)
    stack.setCustomSpacing(8, after: heading)

    // The words scroll at the largest text, and Done stays where a thumb can reach it.
    let scroll = UIScrollView(), content = UIView()
    scroll.alwaysBounceVertical = false
    var style = UIButton.Configuration.filled()
    style.title = theme.doneTitle
    style.cornerStyle = .capsule
    style.baseBackgroundColor = theme.action
    style.baseForegroundColor = theme.onAction
    style.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 20, bottom: 14, trailing: 20)
    style.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { [weak self] incoming in
      var outgoing = incoming
      if let self { outgoing.font = Self.scaled(theme.buttonFont, .body, self.traitCollection) }
      return outgoing
    }
    done.configuration = style
    done.isHidden = true
    done.addTarget(self, action: #selector(tappedDone), for: .touchUpInside)

    for view in [brandRow, scroll, done] as [UIView] { view.translatesAutoresizingMaskIntoConstraints = false; addSubview(view) }
    for view in [content, stack] as [UIView] { view.translatesAutoresizingMaskIntoConstraints = false }
    scroll.addSubview(content)
    content.addSubview(stack)
    let guide = safeAreaLayoutGuide, centred = stack.centerYAnchor.constraint(equalTo: content.centerYAnchor)
    centred.priority = .defaultHigh
    NSLayoutConstraint.activate([
      brandRow.topAnchor.constraint(equalTo: guide.topAnchor, constant: 16),
      brandRow.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 20),
      brandRow.trailingAnchor.constraint(lessThanOrEqualTo: guide.trailingAnchor, constant: -20),
      scroll.topAnchor.constraint(equalTo: brandRow.bottomAnchor, constant: 8),
      scroll.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
      scroll.trailingAnchor.constraint(equalTo: guide.trailingAnchor),
      scroll.bottomAnchor.constraint(equalTo: done.topAnchor, constant: -8),
      done.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 20),
      done.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -20),
      done.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -16),
      content.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
      content.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
      content.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
      content.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
      content.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
      content.heightAnchor.constraint(greaterThanOrEqualTo: scroll.frameLayoutGuide.heightAnchor),
      centred,
      stack.topAnchor.constraint(greaterThanOrEqualTo: content.topAnchor, constant: 12),
      stack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -12),
      stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 26),
      stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -26),
      tile.widthAnchor.constraint(equalToConstant: 76),
      tile.heightAnchor.constraint(equalToConstant: 76),
      glyph.centerXAnchor.constraint(equalTo: tile.centerXAnchor),
      glyph.centerYAnchor.constraint(equalTo: tile.centerYAnchor),
    ])
    show(HafaShareContent(icon: nil, isProblem: false, title: "", detail: nil), animated: false)
  }
  @available(*, unavailable) required init?(coder: NSCoder) { fatalError("Built in code") }

  private static func scaled(_ font: UIFont, _ style: UIFont.TextStyle, _ traits: UITraitCollection? = nil) -> UIFont {
    UIFontMetrics(forTextStyle: style).scaledFont(for: font, compatibleWith: traits)
  }

  func show(_ value: HafaShareContent, animated: Bool) {
    let apply = { [self] in
      heading.text = value.title
      message.text = value.detail
      message.isHidden = value.detail == nil
      tile.isHidden = value.icon == nil
      if let icon = value.icon { spinner.stopAnimating(); glyph.image = UIImage(systemName: icon) } else { spinner.startAnimating() }
      tile.backgroundColor = value.isProblem ? theme.problemTile : theme.tile
      glyph.tintColor = value.isProblem ? theme.problemGlyph : theme.glyph
    }
    guard animated, !UIAccessibility.isReduceMotionEnabled else { return apply() }
    UIView.transition(with: stack, duration: 0.2, options: .transitionCrossDissolve, animations: apply)
  }
  func showDone() { done.isHidden = false }

  override func traitCollectionDidChange(_ previous: UITraitCollection?) {
    super.traitCollectionDidChange(previous)
    done.setNeedsUpdateConfiguration()
  }
  @objc private func tappedDone() { onDone?() }
}
