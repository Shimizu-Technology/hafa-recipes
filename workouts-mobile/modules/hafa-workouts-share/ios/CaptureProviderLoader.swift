  // A single main-actor task owns aggregation. Await each provider in source
  // order; no attachment can publish a partial capture ahead of another one.
  private var loadingShare = false
  private var captureLoadingTask: Task<Void, Never>?
  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    captureLoadingTask?.cancel()
  }
  private func handleViewLoad() {
    guard !loadingShare else { return }
    loadingShare = true
    captureLoadingTask = Task { @MainActor in
      do {
        let attachments = (extensionContext?.inputItems ?? []).compactMap { $0 as? NSExtensionItem }
          .flatMap { $0.attachments ?? [] }
        guard !attachments.isEmpty else { throw captureError("No source was shared.") }
        // Bind even unscoped captures once, before the first provider await.
        guard WorkoutsShareStore.beginStage(sharedKey) else {
          throw captureError("Could not save this source. Please share it again.")
        }
        for attachment in attachments {
          try Task.checkCancellation()
          try await loadCaptureAttachment(attachment)
          try Task.checkCancellation()
        }
        guard !sharedMedia.isEmpty || !sharedWebUrl.isEmpty || sharedText.contains(where: {
          !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }) else { throw captureError("No source could be saved. Please share it again.") }
        try redirectToHostApp(type: .media)
      } catch {
        // Failed cleanup keeps the durable receipt for an exact later retry.
        _ = WorkoutsShareStore.abortStage(sharedKey)
        sharedMedia.removeAll()
        if !Task.isCancelled { dismissWithError(message: error.localizedDescription) }
      }
    }
  }
  private func captureError(_ message: String) -> NSError {
    NSError(domain: "WorkoutsShareCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
  private func loadCaptureAttachment(_ attachment: NSItemProvider) async throws {
    // Prefer a webpage/link over its preview image. File URLs still use the
    // copying path and can never become an automatically queued web source.
    if attachment.hasItemConformingToTypeIdentifier(propertyListType) {
      let item = try await attachment.loadItem(forTypeIdentifier: propertyListType)
      guard let dictionary = item as? NSDictionary,
        let results = dictionary[NSExtensionJavaScriptPreprocessingResultsKey] as? NSDictionary,
        let source = results["baseURI"] as? String, let sourceURL = URL(string: source), !sourceURL.isFileURL
      else { throw captureError("Could not read the shared webpage. Please share it again.") }
      sharedWebUrl.append(WebUrl(url: source, meta: results["meta"] as? String ?? ""))
    } else if attachment.hasItemConformingToTypeIdentifier(urlContentType)
      && !attachment.hasItemConformingToTypeIdentifier(fileURLType) {
      let item = try await attachment.loadItem(forTypeIdentifier: urlContentType)
      guard let url = item as? URL else { throw captureError("Could not read the shared link.") }
      if url.isFileURL { try copyCaptureFile(url, type: attachment.hasItemConformingToTypeIdentifier(imageContentType) ? .image : .file) }
      else { sharedWebUrl.append(WebUrl(url: url.absoluteString, meta: "")) }
    } else if attachment.hasItemConformingToTypeIdentifier(imageContentType) {
      try await handleImages(attachment)
    } else if attachment.hasItemConformingToTypeIdentifier(fileURLType) {
      try await handleCaptureFile(attachment, identifier: fileURLType)
    } else if attachment.hasItemConformingToTypeIdentifier(pdfContentType) {
      try await handleCaptureFile(attachment, identifier: pdfContentType)
    } else if attachment.hasItemConformingToTypeIdentifier(textContentType) {
      try await handleText(attachment)
    } else {
      throw captureError("Share a workout link, text, image or PDF.")
    }
  }
  private func handleText(_ attachment: NSItemProvider) async throws {
    let item = try await attachment.loadItem(forTypeIdentifier: textContentType)
    guard let text = item as? String else { throw captureError("Could not read the shared text.") }
    sharedText.append(text)
  }
  private func handleImages(_ attachment: NSItemProvider) async throws {
    let item = try await attachment.loadItem(forTypeIdentifier: imageContentType)
    if let url = item as? URL {
      try copyCaptureFile(url, type: .image)
      return
    }
    let image: UIImage?
    if let value = item as? UIImage { image = value }
    else if let data = item as? Data { image = UIImage(data: data) }
    else { image = nil }
    guard let image, let data = image.pngData() else { throw captureError("Could not read the shared image.") }
    // Temporary staging is removed even when the shared-container copy fails.
    let staging = FileManager.default.temporaryDirectory.appendingPathComponent("workouts-\(UUID().uuidString).png")
    defer { try? FileManager.default.removeItem(at: staging) }
    try data.write(to: staging, options: .atomic)
    try copyCaptureFile(staging, type: .image)
  }
  private func handleCaptureFile(_ attachment: NSItemProvider, identifier: String) async throws {
    let item = try await attachment.loadItem(forTypeIdentifier: identifier)
    if let url = item as? URL {
      try copyCaptureFile(url, type: .file)
    } else if identifier == pdfContentType, let data = item as? Data {
      let staging = FileManager.default.temporaryDirectory.appendingPathComponent("workouts-\(UUID().uuidString).pdf")
      defer { try? FileManager.default.removeItem(at: staging) }
      try data.write(to: staging, options: .atomic)
      try copyCaptureFile(staging, type: .file)
    } else { throw captureError("Could not read the shared document.") }
  }
  private func copyCaptureFile(_ source: URL, type: SharedMediaType) throws {
    guard source.isFileURL,
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: hostAppGroupIdentifier)
    else { throw captureError("Could not access the shared file. Please share it again.") }
    let scoped = source.startAccessingSecurityScopedResource()
    defer { if scoped { source.stopAccessingSecurityScopedResource() } }
    let fileExtension = getExtension(from: source, type: type)
    let destination = container.appendingPathComponent("\(UUID().uuidString).\(fileExtension)")
    do { try WorkoutsShareStore.copyStagedFile(sharedKey, source: source, destination: destination) }
    catch {
      throw captureError("Could not save the shared file. Please share it again.")
    }
    var width: Int?; var height: Int?
    if type == .image, let imageSource = CGImageSourceCreateWithURL(destination as CFURL, nil),
      let properties = CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as? [CFString: Any] {
      width = properties[kCGImagePropertyPixelWidth] as? Int
      height = properties[kCGImagePropertyPixelHeight] as? Int
      if (properties[kCGImagePropertyOrientation] as? Int ?? 1) > 4 { swap(&width, &height) }
    }
    sharedMedia.append(SharedMediaFile(path: destination.absoluteString, thumbnail: nil,
      fileName: getFileName(from: source, type: type), fileSize: getFileSize(from: destination),
      width: width, height: height, duration: nil, mimeType: destination.mimeType(ext: fileExtension), type: type))
  }
