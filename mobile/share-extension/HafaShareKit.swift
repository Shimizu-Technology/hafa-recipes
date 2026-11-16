import LinkPresentation
import SwiftUI
import UIKit

// The Håfa share card: a compact sheet over the app you shared from. Nothing about any one app is in this file.
// Words, choices and colours come from the app's own file, so Recipes, Workouts and Baby keep identical copies.
// Keep the copies in sync: mobile/share-extension, workouts-mobile/share-extension, baby-mobile/plugins.

struct HafaShareTheme {
  let brandName: String
  let mark: UIImage?
  let card, surface, ink, secondary, hairline, accent, onAccent, accentText, accentSoft, problem, problemSoft: UIColor
  let regular, strong, display: String

  static func colour(_ light: UInt32, _ dark: UInt32, alpha: (CGFloat, CGFloat) = (1, 1)) -> UIColor {
    func make(_ hex: UInt32, _ alpha: CGFloat) -> UIColor {
      UIColor(red: CGFloat(hex >> 16 & 255) / 255, green: CGFloat(hex >> 8 & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: alpha)
    }
    return UIColor { $0.userInterfaceStyle == .dark ? make(dark, alpha.1) : make(light, alpha.0) }
  }

  // Scales with Dynamic Type; falls back to the system face if a bundled font is missing.
  func font(_ name: String, _ size: CGFloat, _ style: Font.TextStyle) -> Font {
    UIFont(name: name, size: size) == nil ? .system(style) : .custom(name, size: size, relativeTo: style)
  }
}

struct HafaSharePreview: Equatable {
  var title: String
  var subtitle: String?
  var image: UIImage?
  var symbol = "link"
}

final class HafaShareModel: ObservableObject {
  @Published var preview: HafaSharePreview
  @Published var choices: [HafaShareChoice] = []
  @Published var notice: (symbol: String, text: String)?
  @Published var note: String?
  @Published var action: String
  @Published var isBusy = true
  @Published var canSave = false
  @Published var outcome: HafaShareOutcome?
  @Published fileprivate(set) var isShown = false
  var onSelect: (_ choice: String, _ option: String) -> Void = { _, _ in }
  var onSave: () -> Void = {}
  var onOutcome: (HafaShareOutcome.Button) -> Void = { _ in }
  // Leaving before an outcome: the app decides whether that discards the capture.
  var onCancel: () -> Void = {}
  private var touched = false
  private var linkProvider: LPMetadataProvider?
  private var previewImageProgress: Progress?
  private var previewTimeout: DispatchWorkItem?
  private var previewGeneration = UUID()

  init(preview: HafaSharePreview, action: String) {
    self.preview = preview
    self.action = action
  }

  func select(_ choice: String, _ option: String) {
    guard !isBusy, let index = choices.firstIndex(where: { $0.id == choice }), choices[index].selected != option else { return }
    onSelect(choice, option)
  }

  func finish(_ outcome: HafaShareOutcome) {
    cancelPreview()
    isBusy = false
    self.outcome = outcome
    UIAccessibility.post(notification: .announcement, argument: [outcome.title, outcome.detail].compactMap { $0 }.joined(separator: ". "))
    // With VoiceOver or Switch Control on, or once she touches the card, it waits for a tap.
    guard outcome.closesItself, !UIAccessibility.isVoiceOverRunning, !UIAccessibility.isSwitchControlRunning else { return }
    touched = false
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.4) { [weak self] in
      guard let self, !self.touched, self.outcome == outcome else { return }
      self.onOutcome(.close)
    }
  }

  func touch() { touched = true }

  func show() { isShown = true }

  // Slides the card away, then hands back to the extension so it can complete the request.
  func dismiss(then done: @escaping () -> Void) {
    cancelPreview()
    isShown = false
    DispatchQueue.main.asyncAfter(deadline: .now() + (UIAccessibility.isReduceMotionEnabled ? 0.12 : 0.26), execute: done)
  }

  func cancelPreview() {
    previewGeneration = UUID()
    linkProvider?.cancel(); linkProvider = nil
    previewImageProgress?.cancel(); previewImageProgress = nil
    previewTimeout?.cancel(); previewTimeout = nil
  }

  func loadPreview(_ url: URL, describe: @escaping (String?) -> (title: String, subtitle: String?)?) {
    cancelPreview()
    guard HafaSharePreviewPolicy.allows(url) else { return }
    let generation = previewGeneration
    let provider = LPMetadataProvider()
    provider.shouldFetchSubresources = true
    provider.timeout = 5
    linkProvider = provider
    let timeout = DispatchWorkItem { [weak self] in
      guard let self, self.previewGeneration == generation else { return }
      self.cancelPreview()
    }
    previewTimeout = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: timeout)
    provider.startFetchingMetadata(for: url) { [weak self] metadata, _ in
      DispatchQueue.main.async {
        guard let self, self.previewGeneration == generation, let metadata else { return }
        if let described = describe(metadata.title) {
          self.preview.title = described.title
          self.preview.subtitle = described.subtitle ?? self.preview.subtitle
        }
        // Policy-approved pages can supply their preview image. Downsample
        // its file representation instead of requesting a full decoded UIImage.
        guard let imageProvider = metadata.imageProvider ?? metadata.iconProvider,
          let type = imageProvider.registeredTypeIdentifiers.first else { return }
        self.previewImageProgress = imageProvider.loadFileRepresentation(forTypeIdentifier: type) { [weak self] url, _ in
          let image = url.flatMap(HafaShareThumbnail.image)
          DispatchQueue.main.async {
            guard let self, self.previewGeneration == generation, let image else { return }
            self.preview.image = UIImage(cgImage: image)
          }
        }
      }
    }
  }

  func loadThumbnail(_ url: URL) {
    let generation = previewGeneration
    DispatchQueue.global(qos: .utility).async { [weak self] in
      let image = HafaShareThumbnail.image(at: url)
      DispatchQueue.main.async {
        guard let self, self.previewGeneration == generation, let image else { return }
        self.preview.image = UIImage(cgImage: image)
      }
    }
  }

}

final class HafaShareHostingController: UIHostingController<HafaShareSheet> {
  init(model: HafaShareModel, theme: HafaShareTheme) {
    super.init(rootView: HafaShareSheet(model: model, theme: theme))
    view.backgroundColor = .clear
  }
  @available(*, unavailable) required init?(coder: NSCoder) { fatalError("Built in code") }
}

struct HafaShareSheet: View {
  @ObservedObject var model: HafaShareModel
  let theme: HafaShareTheme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.dynamicTypeSize) private var typeSize

  private var large: Bool { typeSize.isAccessibilitySize }

  var body: some View {
    ZStack(alignment: .bottom) {
      Color.black.opacity(model.isShown ? 0.38 : 0)
        .ignoresSafeArea()
        .onTapGesture { leave() }
        .accessibilityHidden(true)
      if model.isShown {
        card
          .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
      }
    }
    .animation(reduceMotion ? .easeOut(duration: 0.12) : .spring(response: 0.34, dampingFraction: 0.9), value: model.isShown)
    .onAppear { DispatchQueue.main.async { model.show() } }
  }

  private func leave() {
    if model.outcome != nil { model.onOutcome(.close) } else { model.onCancel() }
  }

  private var card: some View {
    VStack(spacing: 0) {
      header
      ViewThatFits(in: .vertical) {
        content
        ScrollView { content }.scrollBounceBehavior(.basedOnSize)
      }
      footer
    }
    .background(RoundedRectangle(cornerRadius: 30, style: .continuous).fill(Color(theme.card)))
    .overlay(RoundedRectangle(cornerRadius: 30, style: .continuous).stroke(Color(theme.hairline), lineWidth: 1))
    .frame(maxWidth: 520)
    .padding(.horizontal, 8)
    .padding(.bottom, 8)
    .padding(.top, 48)
    .simultaneousGesture(TapGesture().onEnded { model.touch() })
    .accessibilityElement(children: .contain)
    .accessibilityAddTraits(.isModal)
    .accessibilityAction(.escape) { leave() }
    .animation(reduceMotion ? nil : .snappy(duration: 0.24), value: model.outcome)
    .sensoryFeedback(trigger: model.outcome) { _, outcome in
      guard let outcome else { return nil }
      return outcome.isProblem ? .error : .success
    }
  }

  private var header: some View {
    HStack(spacing: 10) {
      if let mark = theme.mark {
        Image(uiImage: mark).resizable().frame(width: 26, height: 26)
          .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
          .accessibilityHidden(true)
      }
      Text(theme.brandName)
        .font(theme.font(theme.strong, 15, .subheadline))
        .foregroundStyle(Color(theme.ink))
        .accessibilityAddTraits(.isHeader)
      Spacer(minLength: 8)
      Button(action: leave) {
        Image(systemName: "xmark")
          .font(.system(size: 13, weight: .bold))
          .foregroundStyle(Color(theme.secondary))
          .frame(width: 30, height: 30)
          .background(Circle().fill(Color(theme.surface)))
          .frame(width: 44, height: 44)
          .contentShape(Rectangle())
      }
      .accessibilityLabel(model.outcome == nil ? "Cancel" : "Close")
    }
    .padding(.leading, 20).padding(.trailing, 10).padding(.top, 8)
    // The brand row is a label, not reading matter; it stays on one line so the content gets the room.
    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
  }

  @ViewBuilder private var content: some View {
    if let outcome = model.outcome {
      outcomeView(outcome)
        .transition(reduceMotion ? .opacity : .scale(scale: 0.96).combined(with: .opacity))
    } else {
      VStack(alignment: .leading, spacing: 18) {
        previewRow
        if let notice = model.notice {
          Label { Text(notice.text) } icon: { Image(systemName: notice.symbol) }
            .font(theme.font(theme.regular, 15, .subheadline))
            .foregroundStyle(Color(theme.ink))
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color(theme.accentSoft)))
        }
        ForEach(model.choices) { choice in choiceView(choice) }
        if let note = model.note {
          Text(note)
            .font(theme.font(theme.regular, 15, .subheadline))
            .foregroundStyle(Color(theme.secondary))
            .fixedSize(horizontal: false, vertical: true)
            .contentTransition(.opacity)
        }
      }
      .padding(.horizontal, 20).padding(.top, 6).padding(.bottom, 4)
    }
  }

  private var previewRow: some View {
    let layout = large ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12)) : AnyLayout(HStackLayout(spacing: 14))
    return layout {
      ZStack {
        RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color(theme.surface))
        if let image = model.preview.image {
          Image(uiImage: image).resizable().scaledToFill()
        } else {
          Image(systemName: model.preview.symbol)
            .font(.system(size: 22, weight: .medium))
            .foregroundStyle(Color(theme.secondary))
        }
      }
      .frame(width: 64, height: 64)
      .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
      .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 3) {
        Text(model.preview.title)
          .font(theme.font(theme.display, 19, .headline))
          .foregroundStyle(Color(theme.ink))
          .lineLimit(large ? 4 : 2)
        if let subtitle = model.preview.subtitle {
          Text(subtitle)
            .font(theme.font(theme.regular, 14, .subheadline))
            .foregroundStyle(Color(theme.secondary))
            .lineLimit(large ? 3 : 1)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityElement(children: .combine)
    }
  }

  private func choiceView(_ choice: HafaShareChoice) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(choice.label)
        .font(theme.font(theme.strong, 13, .footnote))
        .foregroundStyle(Color(theme.secondary))
        .accessibilityAddTraits(.isHeader)
      switch choice.style {
      case .cards:
        let layout = large ? AnyLayout(VStackLayout(spacing: 10)) : AnyLayout(HStackLayout(alignment: .top, spacing: 10))
        // Both cards take the taller one's height, and no more.
        layout {
          ForEach(choice.options) { option in optionCard(choice, option) }
        }
        .fixedSize(horizontal: false, vertical: true)
      case .chips:
        HafaShareFlow(spacing: 8) {
          ForEach(choice.options) { option in chip(choice, option) }
        }
      }
    }
    .accessibilityElement(children: .contain)
    .disabled(model.isBusy)
    .sensoryFeedback(.selection, trigger: choice.selected)
  }

  private func optionCard(_ choice: HafaShareChoice, _ option: HafaShareOption) -> some View {
    let selected = choice.selected == option.id
    return Button { model.select(choice.id, option.id) } label: {
      VStack(alignment: .leading, spacing: 6) {
        HStack(alignment: .top) {
          if let symbol = option.symbol {
            Image(systemName: symbol).font(.system(size: 17, weight: .semibold))
              .foregroundStyle(Color(selected ? theme.accentText : theme.secondary))
          }
          Spacer(minLength: 4)
          Image(systemName: selected ? "checkmark.circle.fill" : "circle")
            .font(.system(size: 20, weight: .regular))
            .foregroundStyle(Color(selected ? theme.accentText : theme.hairline))
        }
        Text(option.title)
          .font(theme.font(theme.strong, 16, .body))
          .foregroundStyle(Color(theme.ink))
        if let detail = option.detail {
          Text(detail)
            .font(theme.font(theme.regular, 13, .footnote))
            .foregroundStyle(Color(theme.secondary))
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      .padding(14)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color(selected ? theme.accentSoft : theme.surface)))
      .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
        .strokeBorder(Color(selected ? theme.accentText : theme.hairline), lineWidth: selected ? 2 : 1))
      .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
    .buttonStyle(HafaSharePress())
    .accessibilityElement(children: .ignore)
    .accessibilityLabel([option.title, option.detail].compactMap { $0 }.joined(separator: ", "))
    .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
  }

  private func chip(_ choice: HafaShareChoice, _ option: HafaShareOption) -> some View {
    let selected = choice.selected == option.id
    return Button { model.select(choice.id, option.id) } label: {
      HStack(spacing: 6) {
        if let symbol = option.symbol { Image(systemName: symbol).font(.system(size: 13, weight: .semibold)) }
        Text(option.title).font(theme.font(theme.strong, 15, .subheadline))
      }
      .foregroundStyle(Color(selected ? theme.onAccent : theme.ink))
      .padding(.horizontal, 14).padding(.vertical, 9)
      .frame(minHeight: 40)
      .background(Capsule().fill(Color(selected ? theme.accent : theme.surface)))
      .overlay(Capsule().strokeBorder(Color(selected ? theme.accent : theme.hairline), lineWidth: 1))
      .contentShape(Capsule())
    }
    .buttonStyle(HafaSharePress())
    .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
  }

  private func outcomeView(_ outcome: HafaShareOutcome) -> some View {
    VStack(spacing: 12) {
      Image(systemName: outcome.symbol)
        .font(.system(size: 24, weight: .semibold))
        .foregroundStyle(Color(outcome.isProblem ? theme.problem : theme.accentText))
        .frame(width: 60, height: 60)
        .background(Circle().fill(Color(outcome.isProblem ? theme.problemSoft : theme.accentSoft)))
        .accessibilityHidden(true)
      Text(outcome.title)
        .font(theme.font(theme.display, 24, .title2))
        .foregroundStyle(Color(theme.ink))
        .multilineTextAlignment(.center)
        .accessibilityAddTraits(.isHeader)
      if let detail = outcome.detail {
        Text(detail)
          .font(theme.font(theme.regular, 16, .body))
          .foregroundStyle(Color(theme.secondary))
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .frame(maxWidth: .infinity)
    .padding(.horizontal, 24).padding(.top, 4).padding(.bottom, 6)
  }

  private var footer: some View {
    VStack(spacing: 4) {
      if let outcome = model.outcome {
        primaryButton(outcome.primary, busy: false) { model.onOutcome(.primary) }
        if let secondary = outcome.secondary {
          Button { model.onOutcome(.secondary) } label: {
            Text(secondary)
              .font(theme.font(theme.strong, 17, .body))
              .foregroundStyle(Color(theme.accentText))
              .frame(maxWidth: .infinity, minHeight: 48)
              .contentShape(Rectangle())
          }
        }
      } else {
        primaryButton(model.action, busy: model.isBusy) { model.onSave() }
          .disabled(!model.canSave || model.isBusy)
      }
    }
    .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 16)
  }

  private func primaryButton(_ title: String, busy: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      HStack(spacing: 10) {
        if busy { ProgressView().tint(Color(theme.onAccent)) }
        Text(title).font(theme.font(theme.strong, 17, .body)).multilineTextAlignment(.center)
      }
      .foregroundStyle(Color(theme.onAccent))
      .frame(maxWidth: .infinity, minHeight: 54)
      .padding(.horizontal, 16)
      .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color(theme.accent)))
      .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
    .buttonStyle(HafaSharePress())
  }
}

private struct HafaSharePress: ButtonStyle {
  @Environment(\.isEnabled) private var isEnabled
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.97 : 1)
      .opacity(isEnabled ? 1 : 0.55)
      .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
  }
}

// Chips wrap onto new lines instead of scrolling sideways, so nothing hides at large text.
private struct HafaShareFlow: Layout {
  var spacing: CGFloat
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    arrange(proposal.width ?? .infinity, subviews).size
  }
  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    for (index, origin) in arrange(bounds.width, subviews).origins.enumerated() {
      subviews[index].place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
    }
  }
  private func arrange(_ width: CGFloat, _ subviews: Subviews) -> (origins: [CGPoint], size: CGSize) {
    var origins: [CGPoint] = [], x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
    for subview in subviews {
      let size = subview.sizeThatFits(.init(width: width, height: nil))
      if x > 0, x + size.width > width { x = 0; y += line + spacing; line = 0 }
      origins.append(CGPoint(x: x, y: y))
      x += size.width + spacing; line = max(line, size.height); widest = max(widest, x - spacing)
    }
    return (origins, CGSize(width: widest, height: y + line))
  }
}
