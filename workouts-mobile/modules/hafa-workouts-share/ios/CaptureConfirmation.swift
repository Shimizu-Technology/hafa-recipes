  private func redirectToHostApp(type: RedirectType) throws {
    let identifier = UUID().uuidString.lowercased()
    let text = sharedText.joined(separator: "\n")
    let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
    let links = detector?.matches(in: text, range: NSRange(text.startIndex..., in: text)) ?? []
    let link = sharedWebUrl.first?.url ?? (links.count == 1 ? links.first?.url?.absoluteString : nil)
    let files = sharedMedia.map { f -> [String: Any] in
      var file: [String: Any] = ["path": f.path, "mimeType": f.mimeType, "fileName": f.fileName]
      file["width"] = f.width; file["height"] = f.height; return file
    }
    guard link != nil || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !files.isEmpty
    else { throw captureError("No source could be saved. Please share it again.") }
    var capture: [String: Any] = ["captureKey": sharedKey, "captureId": identifier, "text": text, "files": files, "visibilityPending": true]
    capture["url"] = link
    capturePayload = capture
    showConfirmation(title: "Saving your source", detail: "Keeping the source on this device before importing it.", finished: false)
    saveCaptureSource()
  }
  private var capturePayload: [String: Any]?
  private var captureDurable = false
  private var captureWriting = false
  private var captureWriteID: UUID?
  private var captureImporting = false
  private var captureIsPublic = false
  private var captureConfirmationFinished = false
  private var captureChoices: [UIButton] = []
  private var captureBrand: UILabel?
  private var captureTitle: UILabel?
  private var captureDetail: UILabel?
  private var capturePrivacy: UILabel?
  private var captureSpinner: UIActivityIndicatorView?
  private var captureDone: UIButton?
  private var captureClose: UIButton?
  private var captureDoneTitle = "Import workout"

  // The queue captures immutable inputs, never the controller. Close and the
  // main-queue watchdog remain responsive even during lock/disk contention.
  private func writeCapture<T>(_ operation: @escaping () -> T, completion: @escaping (ShareViewController, T) -> Void) {
    guard !captureWriting, !captureConfirmationFinished else { return }
    let id = UUID(); captureWriteID = id; captureWriting = true
    refreshCaptureControls(); captureSpinner?.startAnimating()
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
      guard let self, self.captureWriteID == id, !self.captureConfirmationFinished else { return }
      self.captureDetail?.text = self.captureDurable
        ? "Saving is taking longer. Your source is safe. You can close this sheet and continue in Håfa Workouts."
        : "Saving is taking longer. You can wait, or close this sheet and share the source again."
    }
    WorkoutsShareStore.performCaptureWrite(operation) { [weak self] result in
      guard let self, self.captureWriteID == id, !self.captureConfirmationFinished else { return }
      self.captureWriteID = nil; self.captureWriting = false; self.captureSpinner?.stopAnimating()
      completion(self, result)
      self.refreshCaptureControls()
    }
  }
  private func saveCaptureSource() {
    guard let payload = capturePayload else { return }
    let key = sharedKey
    writeCapture({ WorkoutsShareStore.promoteStage(key, payload: payload) }) { controller, result in
      guard let isPublic = result else {
        controller.captureDoneTitle = "Try saving source again"
        controller.captureDetail?.text = "Couldn’t save this source. Try again before closing this sheet."
        return
      }
      controller.captureDurable = true; controller.capturePayload = nil; controller.captureIsPublic = isPublic
      controller.captureDoneTitle = "Import workout"
      controller.showConfirmation(title: "Save this workout", detail: "Choose where this workout goes. Incomplete imports always stay private.", finished: false)
    }
  }
  @objc private func visibilityChanged(_ sender: UIButton) {
    guard captureDurable, !captureWriting, !captureImporting, !captureConfirmationFinished else { return }
    let key = sharedKey, requested = sender.tag == 1
    writeCapture({ WorkoutsShareStore.chooseVisibility(key, isPublic: requested) }) { controller, saved in
      if saved {
        controller.captureIsPublic = requested
        controller.captureDetail?.text = "Choice saved for this workout. Incomplete imports always stay private."
      } else {
        controller.captureDetail?.text = "Couldn’t save the choice. Try again. Your source and last saved choice are safe."
      }
    }
  }
  @objc private func beginImport() {
    guard !captureWriting else { return }
    if captureConfirmationFinished { finishConfirmation(); return }
    if captureImporting { return }
    if !captureDurable { saveCaptureSource(); return }
    let key = sharedKey, requested = captureIsPublic
    writeCapture({ WorkoutsShareStore.chooseVisibility(key, isPublic: requested, confirmed: true) }) { controller, saved in
      guard saved else {
        controller.captureDetail?.text = "Couldn’t save the choice. Try again. Your source and last saved choice are safe."
        return
      }
      controller.captureImporting = true
      controller.showConfirmation(title: "Saving your workout", detail: "Adding the source to Håfa Workouts.", finished: false)
      controller.enqueueCapture(key)
    }
  }
  private func enqueueCapture(_ key: String) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.completeConfirmation(accepted: false) }
    DispatchQueue.global(qos: .utility).async { [weak self] in
      WorkoutsShareStore.enqueue(key) { accepted in
        DispatchQueue.main.async { [weak self] in self?.completeConfirmation(accepted: accepted) }
      }
    }
  }
  private func completeConfirmation(accepted: Bool) {
    guard !captureConfirmationFinished else { return }
    captureConfirmationFinished = true
    showConfirmation(title: accepted ? "Import started" : "Saved for later",
      detail: accepted ? "Your workout will be saved in your library. You can keep browsing."
        : "Your source is saved on this device. Open Håfa Workouts to finish importing it.", finished: true)
  }
  private func showConfirmation(title: String, detail: String, finished: Bool) {
    if captureTitle == nil {
      view.backgroundColor = .systemBackground
      view.isOpaque = true; preferredContentSize = CGSize(width: 420, height: 400)
      let scroll = UIScrollView(); scroll.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(scroll)
      NSLayoutConstraint.activate([scroll.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
        scroll.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
        scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
        scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)])
      let stack = UIStackView(); stack.axis = .vertical; stack.spacing = 20
      stack.translatesAutoresizingMaskIntoConstraints = false; scroll.addSubview(stack)
      let brand = UILabel(); brand.text = "Håfa Workouts"; brand.textColor = .label; brand.numberOfLines = 0
      let heading = UILabel(); heading.textColor = brand.textColor; heading.numberOfLines = 0; heading.accessibilityTraits.insert(.header)
      let message = UILabel(); message.textColor = Self.captureColor(0x6F6F74, 0xA9A9AF); message.numberOfLines = 0
      let privacy = UILabel(); privacy.textColor = message.textColor; privacy.numberOfLines = 0
      privacy.text = "Only complete workouts can appear in Discover. You can change sharing later in Håfa Workouts."
      let choices = UIStackView(); choices.axis = .vertical; choices.spacing = 8
      for (index, title) in ["Private", "Share to Discover"].enumerated() {
        let button = UIButton(type: .system); button.tag = index
        var style = UIButton.Configuration.tinted(); style.title = title; style.titleLineBreakMode = .byWordWrapping; style.titleAlignment = .center
        style.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16); style.cornerStyle = .capsule
        button.configuration = style; button.contentHorizontalAlignment = .center
        button.titleLabel?.numberOfLines = 0; button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
        button.accessibilityLabel = "Workout visibility, \(title)"
        button.addTarget(self, action: #selector(visibilityChanged(_:)), for: .touchUpInside)
        choices.addArrangedSubview(button); captureChoices.append(button)
      }
      let spinner = UIActivityIndicatorView(style: .medium); spinner.color = Self.captureColor(0xC8471C, 0xFF7A50); spinner.hidesWhenStopped = true
      let done = UIButton(type: .system); var style = UIButton.Configuration.filled()
      style.baseBackgroundColor = Self.captureColor(0xC8471C, 0xFF7A50); style.baseForegroundColor = Self.captureColor(0xFFFFFF, 0x2A0D00)
      style.titleLineBreakMode = .byWordWrapping; style.titleAlignment = .center; style.cornerStyle = .capsule
      style.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 20, bottom: 14, trailing: 20)
      done.configuration = style; done.titleLabel?.numberOfLines = 0
      done.heightAnchor.constraint(greaterThanOrEqualToConstant: 50).isActive = true
      done.addTarget(self, action: #selector(beginImport), for: .touchUpInside)
      let close = UIButton(type: .system); close.setTitle("Close", for: .normal)
      close.titleLabel?.adjustsFontForContentSizeCategory = true
      close.tintColor = Self.captureColor(0xC8471C, 0xFF7A50)
      captureClose = close
      close.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
      close.addTarget(self, action: #selector(finishConfirmation), for: .touchUpInside)
      [brand, heading, message, choices, privacy, spinner, done, close].forEach { stack.addArrangedSubview($0) }
      NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 24),
        stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -24),
        stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -48),
        stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 24),
        stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -24)])
      captureBrand = brand; captureTitle = heading; captureDetail = message; capturePrivacy = privacy; captureSpinner = spinner; captureDone = done
      refreshCaptureFonts()
    }
    captureTitle?.text = title; captureDetail?.text = detail
    if finished { captureDoneTitle = "Done"; captureImporting = true; captureSpinner?.stopAnimating(); UIAccessibility.post(notification: .announcement, argument: title) }
    else if captureImporting { captureSpinner?.startAnimating() }
    refreshCaptureControls()
  }
  private func refreshCaptureControls() {
    let enabled = captureDurable && !captureWriting && !captureImporting && !captureConfirmationFinished
    for button in captureChoices {
      button.isEnabled = enabled; button.isSelected = (button.tag == 1) == captureIsPublic
      // Explicit trait edits must not retain the initial saving state.
      button.accessibilityTraits.remove(.notEnabled)
      if !enabled { button.accessibilityTraits.insert(.notEnabled) }
      if button.isSelected { button.accessibilityTraits.insert(.selected) } else { button.accessibilityTraits.remove(.selected) }
      var style = button.configuration
      style?.baseBackgroundColor = button.isSelected ? Self.captureColor(0xC8471C, 0xFF7A50) : .secondarySystemBackground
      style?.baseForegroundColor = button.isSelected ? Self.captureColor(0xFFFFFF, 0x2A0D00) : .label; button.configuration = style
    }
    captureDone?.isEnabled = !captureWriting && (!captureImporting || captureConfirmationFinished)
    var style = captureDone?.configuration; style?.title = captureDoneTitle; captureDone?.configuration = style
  }
  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    if previousTraitCollection?.preferredContentSizeCategory != traitCollection.preferredContentSizeCategory { refreshCaptureFonts() }
  }
  private func refreshCaptureFonts() {
    for (label, size, style, weight) in [(captureBrand, CGFloat(22), UIFont.TextStyle.title2, UIFont.Weight.bold),
      (captureTitle, 20, .title3, .semibold), (captureDetail, 17, .body, .regular), (capturePrivacy, 13, .footnote, .regular)] {
      label?.font = Self.captureFont(size: size, style: style, weight: weight, traits: traitCollection)
      label?.adjustsFontForContentSizeCategory = true
    }
    // Transformers capture a font value only, so button configurations cannot
    // retain this controller. Rebuild them on a live content-size change.
    let font = Self.captureFont(size: 17, style: .headline, weight: .semibold, traits: traitCollection)
    captureClose?.titleLabel?.font = font
    for button in captureChoices + [captureDone].compactMap({ $0 }) {
      var style = button.configuration
      style?.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
        var updated = attributes; updated.font = font; return updated
      }
      button.configuration = style
    }
  }
  @objc private func finishConfirmation() {
    captureConfirmationFinished = true; captureWriteID = nil
    extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
  }
  private static func captureColor(_ light: UInt32, _ dark: UInt32) -> UIColor {
    UIColor { traits in
      let hex = traits.userInterfaceStyle == .dark ? dark : light
      return UIColor(red: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255,
        blue: CGFloat(hex & 255) / 255, alpha: 1)
    }
  }
  private static func captureFont(size: CGFloat, style: UIFont.TextStyle, weight: UIFont.Weight, traits: UITraitCollection) -> UIFont {
    UIFontMetrics(forTextStyle: style).scaledFont(for: .systemFont(ofSize: size, weight: weight), compatibleWith: traits)
  }
