  private func redirectToHostApp(type: RedirectType) {
    guard let producer = babyProducer else { return }
    babyPublished = true
    // It's safely on the phone now, so closing is safe too: what this doesn't deliver, the app will.
    showBabySheet(.saving)
    babySheet?.showAction(BabyShareSheetState.saving.buttonTitle)
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.completeConfirmation(status: nil) }
    DispatchQueue.global(qos: .utility).async { [weak self] in
      BabyShareSession.enqueue(producer.capture.id, storage: producer.storage) { status in
        DispatchQueue.main.async { [weak self] in self?.completeConfirmation(status: status) }
      }
    }
  }
  private var captureConfirmationFinished = false
  private func completeConfirmation(status: String?) {
    guard !captureConfirmationFinished, let producer = babyProducer else { return }
    captureConfirmationFinished = true
    showBabySheet(.after(scope: producer.capture.scope, signedIn: producer.capture.signedIn, status: status))
  }
  private var babySheet: HafaShareSheetView?
  private func showBabySheet(_ state: BabyShareSheetState) {
    let first = babySheet == nil
    if first {
      let sheet = HafaShareSheetView(theme: BabyShareTheme.value)
      sheet.onDone = { [weak self] in self?.finishConfirmation() }
      sheet.translatesAutoresizingMaskIntoConstraints = false
      view.backgroundColor = BabyShareTheme.value.background
      view.isOpaque = true
      view.addSubview(sheet)
      NSLayoutConstraint.activate([sheet.leadingAnchor.constraint(equalTo: view.leadingAnchor), sheet.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        sheet.topAnchor.constraint(equalTo: view.topAnchor), sheet.bottomAnchor.constraint(equalTo: view.bottomAnchor)])
      babySheet = sheet
    }
    babySheet?.show(BabyShareTheme.content(state), animated: !first)
    guard state != .saving else { return }
    babySheet?.showAction(state.buttonTitle)
    let words = state.words
    UIAccessibility.post(notification: .announcement, argument: [words.title, words.detail].compactMap { $0 }.joined(separator: ". "))
    // With VoiceOver or Switch Control on, it waits to be read and for Done.
    if words.closesItself, !UIAccessibility.isVoiceOverRunning, !UIAccessibility.isSwitchControlRunning {
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.finishConfirmation() }
    }
  }
