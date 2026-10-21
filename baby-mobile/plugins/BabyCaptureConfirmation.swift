  private func redirectToHostApp(type: RedirectType) {
    guard let producer = babyProducer else { return }
    showConfirmation(title: "Saving your source", detail: "Keeping the original in Håfa Baby.", finished: false)
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.completeConfirmation(status: nil) }
    DispatchQueue.global(qos: .utility).async { [weak self] in
      BabyShareSession.enqueue(producer.capture.id, storage: producer.storage) { status in
        DispatchQueue.main.async { [weak self] in self?.completeConfirmation(status: status) }
      }
    }
  }
  private var captureConfirmationFinished = false
  private func completeConfirmation(status: String?) {
    guard !captureConfirmationFinished else { return }
    captureConfirmationFinished = true
    let title = status == "queued" ? "Import started" : status != nil ? "Saved to Håfa Baby" : "Saved on this phone"
    let detail = status == "queued" ? "Your source is saved and waiting to be processed. You can keep browsing."
      : status == "deferred" ? "Your original is saved. Processing will wait until there is room."
      : status != nil ? "Your original is saved privately. You can keep browsing."
      : "Your original is kept on this phone. Open Håfa Baby to finish saving when you are online."
    showConfirmation(title: title, detail: detail, finished: true)
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
      let brand = UILabel(); brand.text = "Håfa Baby"; brand.textColor = .white
      brand.font = .preferredFont(forTextStyle: .title2); brand.adjustsFontForContentSizeCategory = true
      let heading = UILabel(); heading.textColor = .white; heading.numberOfLines = 0
      heading.font = .preferredFont(forTextStyle: .headline); heading.adjustsFontForContentSizeCategory = true
      heading.accessibilityTraits.insert(.header)
      let message = UILabel(); message.textColor = UIColor(white: 0.82, alpha: 1); message.numberOfLines = 0
      message.font = .preferredFont(forTextStyle: .body); message.adjustsFontForContentSizeCategory = true
      let privacy = UILabel(); privacy.textColor = message.textColor; privacy.numberOfLines = 0
      privacy.font = .preferredFont(forTextStyle: .footnote); privacy.adjustsFontForContentSizeCategory = true
      privacy.text = "Private to your Baby account"
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
  @objc private func finishConfirmation() { captureConfirmationFinished = true; extensionContext?.completeRequest(returningItems: [], completionHandler: nil) }
