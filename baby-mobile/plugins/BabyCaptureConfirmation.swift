  // Everything this share brought is staged on the phone, and none of it is saved yet. The card shows what it is and
  // offers her categories. Save publishes it, which is the moment it's kept; closing before then keeps nothing.
  private func redirectToHostApp(type: RedirectType) {
    guard let producer = babyProducer, let payload = babyPayload, !captureConfirmationFinished else { return }
    babyStaged = true
    let card = babyCard()
    let share = BabyShareWords.describe(payload)
    card.preview = HafaSharePreview(title: share.title, subtitle: share.subtitle, symbol: share.symbol)
    if let link = share.link {
      let fromPage = share.title != BabyShareWords.fallbackTitle(site: HafaSharePreviewText.site(link))
      card.loadPreview(link) { title in
        // A page title only replaces what the share already said when it says more.
        guard !fromPage, let title else { return nil }
        let fetched = HafaSharePreviewText.describe(url: link, pageTitle: title, fallback: BabyShareWords.fallbackTitle)
        return (fetched.title, fetched.subtitle)
      }
    }
    if let photo = share.photo { card.loadThumbnail(photo) }
    babyCategories = BabyShareSession.categories(for: producer.capture.scope)
    card.notice = BabyShareWords.notice(scope: producer.capture.scope, signedIn: producer.capture.signedIn)
    refreshBabyCard()
    card.isBusy = false
    card.canSave = true
  }
  private func refreshBabyCard() {
    guard let producer = babyProducer else { return }
    babyCard().choices = [BabyShareWords.categoryChoice(babyCategories, selected: babyCategory)].compactMap { $0 }
    babyCard().note = BabyShareWords.note(scope: producer.capture.scope, category: babyCategoryTitle)
  }
  private var babyCategoryTitle: String? {
    babyCategories.first { $0["id"] == babyCategory }?["title"]
  }
  private func saveBabyShare() {
    guard let producer = babyProducer, !captureConfirmationFinished, !babySheetClosed else { return }
    let card = babyCard()
    guard publishBabyCapture(collection: babyCategoryTitle == nil ? nil : babyCategory, then: { [weak self] result in
      guard let self, !self.babySheetClosed else { return }
      switch result {
      case .kept:
        self.setBabySaveState(.saved)
        self.submitBabyShare(producer)
      case .failed, .notKept:
        // Nothing here deletes it. Try again comes back to this card, ✕ keeps it, and Discard is the one way to delete it.
        self.setBabySaveState(.failed)
        card.finish(result == .failed ? BabyShareSheetState.saveFailed : BabyShareSheetState.saveNotKept)
      case .gone:
        self.setBabySaveState(.failed)
        self.captureConfirmationFinished = true
        if let outcome = BabyShareSheetState.failed.outcome() { card.finish(outcome) }
      case .slow, .slowUnmarked:
        // Close keeps it either way; only a marked one is promised to the app.
        self.setBabySaveState(.slow)
        card.finish(result == .slow ? BabyShareSheetState.saveSlow : BabyShareSheetState.saveSlowUnmarked)
      }
    }) else { return }
    card.outcome = nil
    setBabySaveState(.saving)
  }
  private func babyAlreadySaved() {
    setBabySaveState(.saved)
    captureConfirmationFinished = true
    babyCard().finish(BabyShareSheetState.alreadySaved)
  }
  // The same rule as Recipes: no way out of the card, and no swiping the sheet away, only while a save is under way.
  private func setBabySaveState(_ state: HafaShareSaveState) {
    babyCard().saveState = state
    isModalInPresentation = state == .saving
    navigationController?.isModalInPresentation = state == .saving
  }
  private func babyPublishOffMain(_ work: @escaping () -> BabyShareSheetState.Publication, then done: @escaping (BabyShareSheetState.Publication) -> Void) {
    DispatchQueue.global(qos: .userInitiated).async {
      let result = work()
      DispatchQueue.main.async { done(result) }
    }
  }
  // It's safely on the phone now, so closing is safe too: what this doesn't deliver, the app will.
  private func submitBabyShare(_ producer: (storage: BabyShareStore, capture: BabyShareStore.Capture)) {
    babySaved = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.completeConfirmation(status: nil, filed: false) }
    DispatchQueue.global(qos: .utility).async { [weak self] in
      BabyShareSession.enqueue(producer.capture.id, storage: producer.storage) { status, filed in
        DispatchQueue.main.async { [weak self] in self?.completeConfirmation(status: status, filed: filed) }
      }
    }
  }
  private var captureConfirmationFinished = false
  private func completeConfirmation(status: String?, filed: Bool) {
    guard !captureConfirmationFinished, !babySheetClosed, let producer = babyProducer else { return }
    captureConfirmationFinished = true
    let state = BabyShareSheetState.after(scope: producer.capture.scope, signedIn: producer.capture.signedIn, status: status)
    guard let outcome = state.outcome(category: babyCategoryTitle, filed: filed) else { return }
    babyCard().finish(outcome)
  }
  private var babyCardModel: HafaShareModel?
  private var babyPayload: Any?
  private var babyCategories: [[String: String]] = []
  private var babyCategory = BabyShareWords.later
  private var babySaved = false
  private func babyCard() -> HafaShareModel {
    if let card = babyCardModel { return card }
    let card = HafaShareModel(preview: HafaSharePreview(title: BabyShareWords.loading, symbol: "tray.and.arrow.down"), action: BabyShareWords.action)
    card.onSelect = { [weak self] _, option in self?.babyCategory = option; self?.refreshBabyCard() }
    card.onSave = { [weak self] in self?.saveBabyShare() }
    card.onCancel = { [weak self] in self?.finishConfirmation() }
    card.onOutcome = { [weak self] button in
      guard let self else { return }
      if let outcome = self.babyCardModel?.outcome, [BabyShareSheetState.saveFailed, BabyShareSheetState.saveNotKept].contains(outcome) {
        if button == .primary { return self.saveBabyShare() }
        if button == .secondary { return self.discardBabyShare() }
      }
      if button != .close, button == self.babyCardModel?.outcome?.opens { self.openBabyApp() }
      self.finishConfirmation()
    }
    babyCardModel = card
    view.backgroundColor = .clear
    view.isOpaque = false
    let host = HafaShareHostingController(model: card, theme: BabyShareTheme.value)
    addChild(host)
    host.view.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(host.view)
    NSLayoutConstraint.activate([
      host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor), host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      host.view.topAnchor.constraint(equalTo: view.topAnchor), host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    host.didMove(toParent: self)
    return card
  }
  // The card's busy states, and every answer it can end with.
  private func showBabySheet(_ state: BabyShareSheetState) {
    let card = babyCard()
    switch state {
    case .saving: card.isBusy = true
    case .stillWorking: card.note = [state.words.title, state.words.detail].compactMap { $0 }.joined(separator: ". ")
    default: if let outcome = state.outcome() { card.finish(outcome) }
    }
  }
  private func closeBabyCard(then done: @escaping () -> Void) {
    guard let card = babyCardModel else { return done() }
    card.dismiss(then: done)
  }
  // Håfa Baby picks up whatever's waiting on the phone as soon as it opens.
  private func openBabyApp() {
    guard let url = URL(string: "\(shareProtocol)://") else { return }
    var responder: UIResponder? = self
    while let current = responder {
      if let application = current as? UIApplication { application.open(url, options: [:], completionHandler: nil); return }
      responder = current.next
    }
  }
  private func dismissWithError(message: String? = nil) {
    // Every path left from the library ends here, some carrying private detail. None of it is shown or logged.
    showBabyProblem(.failed)
  }
  private func showBabyProblem(_ state: BabyShareSheetState) {
    DispatchQueue.main.async { [self] in
      // The first answer stands. A provider answering after Stop or the time limit has nothing more to say.
      guard !captureConfirmationFinished else { return }
      abortBabyShare()
      captureConfirmationFinished = true
      showBabySheet(state == .failed && babyPhoneLocked() ? .locked : state)
    }
  }
  // Complete protection keeps the store closed while the phone is locked. The share is still in the app it came from.
  private func babyPhoneLocked() -> Bool {
    (babyProducer?.storage ?? (try? babyShareStore()))?.protectedDataClosed() == true || BabyShareSession.protectedDataClosed()
  }
  private func babyFileFits(name: String, mimeType: String, size: Int?) -> Bool {
    guard let refusal = BabyShareSheetState.refusal(mimeType: mimeType, name: name, size: size) else { return true }
    showBabyProblem(refusal)
    return false
  }
