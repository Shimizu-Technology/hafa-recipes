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
    guard let isPublic = WorkoutsShareStore.promoteStage(sharedKey, payload: capture)
    else { throw captureError("Could not save this workout. Please share it again.") }
    captureIsPublic = isPublic
    showConfirmation(title: "Save this workout", detail: "Choose where this workout goes. Incomplete imports always stay private.",
      finished: false, isPublic: isPublic)
    captureVisibility?.isHidden = false
    captureDone?.setTitle("Import workout", for: .normal); captureDone?.isEnabled = true
    captureSpinner?.stopAnimating()
  }
  @objc private func beginImport() {
    guard !captureImporting else { finishConfirmation(); return }
    guard WorkoutsShareStore.chooseVisibility(sharedKey, isPublic: captureIsPublic, confirmed: true) else {
      captureVisibility?.isEnabled = false
      showConfirmation(title: "Source saved", detail: "Open Håfa Workouts to continue with your saved source.", finished: true, isPublic: false)
      return
    }
    captureImporting = true; captureVisibility?.isEnabled = false
    let key = sharedKey, isPublic = captureIsPublic
    showConfirmation(title: "Saving your workout", detail: "Adding the source to Håfa Workouts.", finished: false, isPublic: isPublic)
    // The capture is durable now. Never make dismissal depend on a shared
    // file lock or a network callback; the host can process it without a job ID.
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
      self?.completeConfirmation(accepted: false, isPublic: isPublic)
    }
    DispatchQueue.global(qos: .utility).async { [weak self] in
      WorkoutsShareStore.enqueue(key) { accepted in
        DispatchQueue.main.async { [weak self] in
          self?.completeConfirmation(accepted: accepted, isPublic: isPublic)
        }
      }
    }
  }
  private var captureImporting = false
  private var captureIsPublic = false
  private var captureVisibility: UISegmentedControl?
  @objc private func visibilityChanged(_ sender: UISegmentedControl) {
    let isPublic = sender.selectedSegmentIndex == 1
    guard WorkoutsShareStore.chooseVisibility(sharedKey, isPublic: isPublic) else {
      sender.selectedSegmentIndex = captureIsPublic ? 1 : 0
      captureDetail?.text = "Couldn’t change this saved choice. Open Håfa Workouts to continue."
      return
    }
    captureIsPublic = isPublic
  }
  private var captureConfirmationFinished = false
  private func completeConfirmation(accepted: Bool, isPublic: Bool) {
    guard !captureConfirmationFinished else { return }
    captureConfirmationFinished = true
    showConfirmation(title: accepted ? "Import started" : "Saved for later",
      detail: accepted ? "Your workout will be saved in your library. You can keep browsing."
        : "Your source is saved on this device. Open Håfa Workouts to finish importing it.",
      finished: true, isPublic: isPublic)
  }
  private var captureTitle: UILabel?
  private var captureDetail: UILabel?
  private var captureSpinner: UIActivityIndicatorView?
  private var captureDone: UIButton?
  private func showConfirmation(title: String, detail: String, finished: Bool, isPublic: Bool) {
    if captureTitle == nil {
      view.backgroundColor = captureColor(0xFFF7EC, 0x101411)
      view.isOpaque = true; preferredContentSize = CGSize(width: 420, height: 400)
      let scroll = UIScrollView(); scroll.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(scroll)
      NSLayoutConstraint.activate([scroll.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
        scroll.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
        scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
        scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)])
      let stack = UIStackView(); stack.axis = .vertical; stack.spacing = 20
      stack.translatesAutoresizingMaskIntoConstraints = false; scroll.addSubview(stack)
      let brand = UILabel(); brand.text = "Håfa Workouts"; brand.textColor = captureColor(0x17120E, 0xF8F0E7)
      brand.font = captureFont("Fraunces-SemiBold", size: 24, style: .title2); brand.adjustsFontForContentSizeCategory = true
      let heading = UILabel(); heading.textColor = captureColor(0x17120E, 0xF8F0E7); heading.numberOfLines = 0
      heading.font = captureFont("DMSans-SemiBold", size: 20, style: .headline); heading.adjustsFontForContentSizeCategory = true
      heading.accessibilityTraits.insert(.header)
      let message = UILabel(); message.textColor = captureColor(0x6D5D50, 0xB8AEA2); message.numberOfLines = 0
      message.font = captureFont("DMSans-Regular", size: 17, style: .body); message.adjustsFontForContentSizeCategory = true
      let privacy = UILabel(); privacy.textColor = message.textColor; privacy.numberOfLines = 0
      privacy.font = captureFont("DMSans-Regular", size: 14, style: .footnote); privacy.adjustsFontForContentSizeCategory = true
      privacy.text = "Only complete workouts can appear in Discover. You can change sharing later in Håfa Workouts."
      let visibility = UISegmentedControl(items: ["Private", "Share to Discover"])
      visibility.selectedSegmentIndex = isPublic ? 1 : 0
      visibility.selectedSegmentTintColor = captureColor(0xDDF5F1, 0x1E3A35)
      visibility.setTitleTextAttributes([.font: captureFont("DMSans-SemiBold", size: 14, style: .subheadline),
        .foregroundColor: captureColor(0x17120E, 0xF8F0E7)], for: .normal)
      visibility.addTarget(self, action: #selector(visibilityChanged(_:)), for: .valueChanged)
      visibility.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
      visibility.accessibilityLabel = "Workout visibility"
      captureVisibility = visibility
      let spinner = UIActivityIndicatorView(style: .medium); spinner.color = captureColor(0x155C52, 0x8CD8CC); spinner.hidesWhenStopped = true
      let done = UIButton(type: .system); var style = UIButton.Configuration.filled(); style.title = "Done"
      style.baseBackgroundColor = captureColor(0x155C52, 0x347D73)
      style.baseForegroundColor = captureColor(0xFFF7EC, 0xFFF7EC)
      style.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
        var updated = attributes; updated.font = self.captureFont("DMSans-SemiBold", size: 17, style: .headline); return updated
      }
      style.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 20, bottom: 14, trailing: 20)
      done.configuration = style; done.addTarget(self, action: #selector(beginImport), for: .touchUpInside)
      [brand, heading, message, visibility, privacy, spinner, done].forEach { stack.addArrangedSubview($0) }
      NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 24),
        stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -24),
        stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -48),
        stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 24),
        stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -24)])
      captureTitle = heading; captureDetail = message; captureSpinner = spinner; captureDone = done
    }
    captureTitle?.text = title; captureDetail?.text = detail; captureDone?.isEnabled = finished
    if finished { captureDone?.setTitle("Done", for: .normal); captureImporting = true }
    if finished { captureSpinner?.stopAnimating(); UIAccessibility.post(notification: .announcement, argument: title) }
    else { captureSpinner?.startAnimating() }
  }
  @objc private func finishConfirmation() { captureConfirmationFinished = true; extensionContext?.completeRequest(returningItems: [], completionHandler: nil) }

  private func captureColor(_ light: UInt32, _ dark: UInt32) -> UIColor {
    UIColor { traits in
      let hex = traits.userInterfaceStyle == .dark ? dark : light
      return UIColor(red: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255,
        blue: CGFloat(hex & 255) / 255, alpha: 1)
    }
  }
  private func captureFont(_ name: String, size: CGFloat, style: UIFont.TextStyle) -> UIFont {
    UIFontMetrics(forTextStyle: style).scaledFont(for: UIFont(name: name, size: size) ?? .systemFont(ofSize: size))
  }
