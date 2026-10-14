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
    var capture: [String: Any] = ["captureKey": sharedKey, "captureId": identifier, "text": text, "files": files]
    capture["url"] = link
    let saved = WorkoutsShareStore.promoteStage(sharedKey, payload: capture)
    guard saved else { throw captureError("Could not save this workout. Please share it again.") }
    showConfirmation(title: "Saving your workout", detail: "Adding the source to Håfa Workouts.", finished: false)
    WorkoutsShareStore.enqueue(sharedKey) { accepted in
      DispatchQueue.main.async {
        self.showConfirmation(title: accepted ? "Import started" : "Saved for later",
          detail: accepted ? "Your workout will be saved in your library. You can keep browsing."
            : "Your source is saved on this device. Open Håfa Workouts to finish importing it.", finished: true)
      }
    }
  }
  private var captureTitle: UILabel?
  private var captureDetail: UILabel?
  private var captureSpinner: UIActivityIndicatorView?
  private var captureDone: UIButton?
  private func showConfirmation(title: String, detail: String, finished: Bool) {
    if captureTitle == nil {
      view.backgroundColor = UIColor(red: 0.06, green: 0.08, blue: 0.07, alpha: 1)
      view.isOpaque = true; preferredContentSize = CGSize(width: 420, height: 400)
      let scroll = UIScrollView(); scroll.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(scroll)
      NSLayoutConstraint.activate([scroll.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
        scroll.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
        scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
        scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)])
      let stack = UIStackView(); stack.axis = .vertical; stack.spacing = 20
      stack.translatesAutoresizingMaskIntoConstraints = false; scroll.addSubview(stack)
      let brand = UILabel(); brand.text = "Håfa Workouts"; brand.textColor = .white
      brand.font = .preferredFont(forTextStyle: .title2); brand.adjustsFontForContentSizeCategory = true
      let heading = UILabel(); heading.textColor = .white; heading.numberOfLines = 0
      heading.font = .preferredFont(forTextStyle: .headline); heading.adjustsFontForContentSizeCategory = true
      heading.accessibilityTraits.insert(.header)
      let message = UILabel(); message.textColor = UIColor(white: 0.82, alpha: 1); message.numberOfLines = 0
      message.font = .preferredFont(forTextStyle: .body); message.adjustsFontForContentSizeCategory = true
      let privacy = UILabel(); privacy.textColor = message.textColor; privacy.numberOfLines = 0
      privacy.font = .preferredFont(forTextStyle: .footnote); privacy.adjustsFontForContentSizeCategory = true
      let isPublic = WorkoutsShareStore.locked { $0.dictionary(forKey: sharedKey + ".capture")?["isPublic"] as? Bool ?? false } ?? false
      privacy.text = isPublic ? "Requested visibility: Discover" : "Requested visibility: Private"
      let spinner = UIActivityIndicatorView(style: .medium); spinner.color = .white; spinner.hidesWhenStopped = true
      let done = UIButton(type: .system); var style = UIButton.Configuration.filled(); style.title = "Done"
      style.baseBackgroundColor = UIColor(red: 0.16, green: 0.40, blue: 0.34, alpha: 1)
      style.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 20, bottom: 14, trailing: 20)
      done.configuration = style; done.addTarget(self, action: #selector(finishConfirmation), for: .touchUpInside)
      [brand, heading, message, privacy, spinner, done].forEach { stack.addArrangedSubview($0) }
      NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 24),
        stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -24),
        stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -48),
        stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 24),
        stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -24)])
      captureTitle = heading; captureDetail = message; captureSpinner = spinner; captureDone = done
    }
    captureTitle?.text = title; captureDetail?.text = detail; captureDone?.isEnabled = finished
    if finished { captureSpinner?.stopAnimating(); UIAccessibility.post(notification: .announcement, argument: title) }
    else { captureSpinner?.startAnimating() }
  }
  @objc private func finishConfirmation() { extensionContext?.completeRequest(returningItems: [], completionHandler: nil) }
