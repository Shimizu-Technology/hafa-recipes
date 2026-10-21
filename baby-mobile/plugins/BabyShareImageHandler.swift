  private func handleImages(content: NSExtensionItem, attachment: NSItemProvider, index: Int) async {
    // HAFA BABY JOINED IMAGE BATCH v1
    guard let producer = self.babyProducer else {
      self.dismissWithError(message: "Could not prepare this share. Try sharing it again.")
      return
    }
    let storage = producer.storage, capture = producer.capture
    var published = false
    defer { if !published { try? storage.abort(capture) } }
    do {
      guard index == 0, let attachments = content.attachments,
        attachments.allSatisfy({ $0.hasItemConformingToTypeIdentifier(self.imageContentType) })
      else { throw BabyShareImageBatch.InvalidBatch.invalid }
      try await BabyShareImageBatch.process(
        attachments,
        load: { provider in try await self.loadBabyImage(provider, directory: capture.directory) },
        publish: { images in
          let encoded = try JSONEncoder().encode(images)
          try self.publishBabyPayload(encoded)
          published = true
          self.redirectToHostApp(type: .media)
        },
        discard: { image in
          if let url = URL(string: image.path), url.isFileURL {
            try? FileManager.default.removeItem(at: url)
          }
        }
      )
    } catch {
      self.dismissWithError(message: "Could not share all selected images. Try sharing them again.")
    }
  }

  private func loadBabyImage(_ attachment: NSItemProvider, directory: URL) async throws -> SharedMediaFile {
    let item = try await attachment.loadItem(forTypeIdentifier: self.imageContentType)
    let normalized: BabyShareImageNormalization.Image
    if let url = item as? URL, url.isFileURL {
      let scoped = url.startAccessingSecurityScopedResource()
      defer { if scoped { url.stopAccessingSecurityScopedResource() } }
      normalized = try BabyShareImageNormalization.normalize(fileURL: url)
    } else if let bytes = item as? Data {
      normalized = try BabyShareImageNormalization.normalize(bytes: bytes)
    } else if let image = item as? UIImage {
      let pixelWidth = image.size.width * image.scale, pixelHeight = image.size.height * image.scale
      guard pixelWidth.isFinite, pixelHeight.isFinite,
        pixelWidth > 0, pixelHeight > 0,
        pixelWidth <= CGFloat(BabyShareImageNormalization.maxInputDimension),
        pixelHeight <= CGFloat(BabyShareImageNormalization.maxInputDimension)
      else { throw BabyShareImageNormalization.InvalidImage.invalid }
      try BabyShareImageNormalization.validateDimensions(width: Int(pixelWidth), height: Int(pixelHeight))
      let scale = min(1, CGFloat(BabyShareImageNormalization.maxOutputDimension) / max(pixelWidth, pixelHeight))
      let size = CGSize(width: max(1, floor(pixelWidth * scale)), height: max(1, floor(pixelHeight * scale)))
      let format = UIGraphicsImageRendererFormat()
      format.scale = 1
      format.opaque = false
      let upright = UIGraphicsImageRenderer(size: size, format: format).image { _ in
        image.draw(in: CGRect(origin: .zero, size: size))
      }
      guard let pixels = upright.cgImage else { throw BabyShareImageNormalization.InvalidImage.invalid }
      normalized = try BabyShareImageNormalization.normalize(image: pixels)
    } else { throw BabyShareImageNormalization.InvalidImage.invalid }

    let destination = directory.appendingPathComponent(UUID().uuidString + "." + normalized.fileExtension)
    do {
      try normalized.bytes.write(to: destination, options: .atomic)
      try FileManager.default.setAttributes(
        [.protectionKey: FileProtectionType.complete], ofItemAtPath: destination.path)
      let values = try destination.resourceValues(forKeys: [.fileSizeKey])
      guard let fileSize = values.fileSize, fileSize > 0
      else { throw BabyShareImageBatch.InvalidBatch.invalid }
      return SharedMediaFile(
        path: destination.absoluteString, thumbnail: nil,
        fileName: "Image." + normalized.fileExtension,
        fileSize: fileSize, width: normalized.width, height: normalized.height, duration: nil,
        mimeType: normalized.mimeType, type: .image)
    } catch {
      try? FileManager.default.removeItem(at: destination)
      throw error
    }
  }
