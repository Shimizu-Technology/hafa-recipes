  private func handleBabyLinks(_ attachments: [NSItemProvider]) async {
    do {
      guard (1...8).contains(attachments.count) else { throw BabyShareStore.Failure.invalid }
      var rows: [[String: String]] = []
      for provider in attachments {
        if provider.hasItemConformingToTypeIdentifier(urlContentType) {
          guard let link = try await provider.loadItem(forTypeIdentifier: urlContentType) as? URL else {
            throw BabyShareStore.Failure.invalid
          }
          rows.append(["url": link.absoluteString])
        }
        if provider.hasItemConformingToTypeIdentifier(textContentType) {
          guard let text = try await provider.loadItem(forTypeIdentifier: textContentType) as? String else {
            throw BabyShareStore.Failure.invalid
          }
          rows.append(["text": text])
        }
      }
      // A single capture represents one source. Refuse ambiguous multi-link
      // handoff rather than silently dropping a source or its accompanying text.
      guard Set(rows.compactMap { $0["url"] }).count <= 1 else { throw BabyShareStore.Failure.invalid }
      try publishBabyPayload(JSONSerialization.data(withJSONObject: rows))
      redirectToHostApp(type: .weburl)
    } catch {
      abortBabyShare()
      dismissWithError(message: "Could not save this link and text. Try sharing one source again.")
    }
  }
