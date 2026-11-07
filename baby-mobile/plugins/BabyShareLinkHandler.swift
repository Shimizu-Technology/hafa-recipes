  private func handleBabyLinks(_ attachments: [NSItemProvider], content: NSExtensionItem) async {
    do {
      guard (1...8).contains(attachments.count) else { throw BabyShareStore.Failure.invalid }
      var rows: [[String: String]] = []
      for provider in attachments {
        // A contact conforms to text, and it isn't something this keeps.
        if provider.hasItemConformingToTypeIdentifier(vcardContentType) { return showBabyProblem(.unsupported) }
        if provider.hasItemConformingToTypeIdentifier(urlContentType) {
          guard let link = try await provider.loadItem(forTypeIdentifier: urlContentType) as? URL else {
            throw BabyShareStore.Failure.invalid
          }
          // Files can arrive as a URL. That's a file, and its path must never be saved as a link.
          if link.isFileURL { return await handleBabyFileLink(link, provider, attachments, content) }
          rows.append(["url": link.absoluteString])
        }
        if provider.hasItemConformingToTypeIdentifier(textContentType) {
          let item = try await provider.loadItem(forTypeIdentifier: textContentType)
          if let file = item as? URL, file.isFileURL { return await handleBabyFileLink(file, provider, attachments, content) }
          guard let text = item as? String ?? (item as? Data).flatMap({ String(data: $0, encoding: .utf8) }) else {
            throw BabyShareStore.Failure.invalid
          }
          rows.append(["text": text])
        }
      }
      // A single capture represents one source. Refuse ambiguous multi-link
      // handoff rather than silently dropping a source or its accompanying text.
      guard Set(rows.compactMap { $0["url"] }).count <= 1 else { return showBabyProblem(.oneLink) }
      // Nothing to keep, and a blank share in the queue would help no one.
      guard rows.contains(where: { $0["url"] != nil || $0["text"]?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false }) else {
        return dismissWithError(message: "Nothing to save.")
      }
      try publishBabyPayload(JSONSerialization.data(withJSONObject: rows))
      redirectToHostApp(type: .weburl)
    } catch {
      dismissWithError(message: "Could not save this link and text. Try sharing one source again.")
    }
  }
  private func handleBabyFileLink(_ file: URL, _ provider: NSItemProvider, _ attachments: [NSItemProvider], _ content: NSExtensionItem) async {
    // Photos go through their own path, which strips what a photo carries with it and takes up to four.
    if attachments.allSatisfy({ $0.hasItemConformingToTypeIdentifier(imageContentType) }) {
      return await handleImages(content: content, attachment: provider, index: 0)
    }
    guard attachments.count == 1 else { return showBabyProblem(.oneAtATime) }
    await handleFileURL(content: content, url: file, index: 0)
  }
