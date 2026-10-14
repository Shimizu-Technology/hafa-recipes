import ExpoModulesCore
import Foundation
import ImageIO
import UniformTypeIdentifiers

public final class HafaWorkoutsShareModule: Module {
  private static let imageQueue = DispatchQueue(label: "com.shimizutechnology.hafaworkouts.capture-images")
  public func definition() -> ModuleDefinition {
    Name("HafaWorkoutsShare")
    AsyncFunction("normalizeCaptureImage") { [weak self] (source: String, destination: String) throws in
      guard let cache = self?.appContext?.config.cacheDirectory else {
        throw NSError(domain: WorkoutsShareStore.service, code: 6)
      }
      try CaptureImageNormalizer.write(source, to: destination, cacheDirectory: cache)
    }.runOnQueue(Self.imageQueue)
    AsyncFunction("installationId") { () throws -> String in
      guard let id = try WorkoutsShareStore.locked({ d -> String in
        let id = d.string(forKey: WorkoutsShareStore.installationKey) ?? UUID().uuidString
        d.set(id, forKey: WorkoutsShareStore.installationKey)
        guard d.synchronize() else { throw NSError(domain: WorkoutsShareStore.service, code: 8) }
        return id
      }) else { throw NSError(domain: WorkoutsShareStore.service, code: 2) }
      return id
    }
    AsyncFunction("configureSession") { (token: String, base: String, scope: String, expires: String, owner: String, generation: Int, isPublic: Bool) throws in
      let format = ISO8601DateFormatter(); format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      let expiry = format.date(from: expires) ?? ISO8601DateFormatter().date(from: expires)
      guard token.hasPrefix("hfws_v1."), WorkoutsShareStore.baseURL(base) != nil, !scope.isEmpty,
        !owner.isEmpty, generation > 0, let expiry, expiry > Date() else { throw NSError(domain: WorkoutsShareStore.service, code: 3) }
      guard try WorkoutsShareStore.locked({ d -> Bool in
        guard WorkoutsShareStore.reconcileStages(d) else { throw NSError(domain: WorkoutsShareStore.service, code: 4) }
        d.removeObject(forKey: WorkoutsShareStore.sessionKey)
        // Invalidate the old scope durably before replacing its Keychain token.
        guard d.synchronize() else { throw NSError(domain: WorkoutsShareStore.service, code: 8) }
        try WorkoutsShareStore.setToken(token)
        d.set(["apiBaseURL": base, "accountScopeId": scope, "expiresAt": expiry.timeIntervalSince1970,
          "ownerId": owner, "generation": generation, "isPublic": isPublic], forKey: WorkoutsShareStore.sessionKey)
        guard d.synchronize() else {
          try WorkoutsShareStore.setToken(nil)
          throw NSError(domain: WorkoutsShareStore.service, code: 8)
        }
        return true
      }) != nil else { throw NSError(domain: WorkoutsShareStore.service, code: 2) }
    }
    AsyncFunction("captures") { () throws -> String in
      guard let entries = try WorkoutsShareStore.withLock({ defaults, container in
        let d = try WorkoutsShareDefaults(defaults: defaults, container: container)
        guard WorkoutsShareStore.reconcileStages(d) else { throw NSError(domain: WorkoutsShareStore.service, code: 4) }
        guard d.synchronize() else { throw NSError(domain: WorkoutsShareStore.service, code: 8) }
        return (d.stringArray(forKey: WorkoutsShareStore.pending) ?? []).compactMap { d.dictionary(forKey: $0 + ".capture") }
      }) else { throw NSError(domain: WorkoutsShareStore.service, code: 2) }
      return String(data: try JSONSerialization.data(withJSONObject: entries), encoding: .utf8)!
    }
    AsyncFunction("sessionOwner") { () -> String? in
      WorkoutsShareStore.locked { d -> String? in
        guard let state = d.dictionary(forKey: WorkoutsShareStore.sessionKey),
          let owner = state["ownerId"] as? String, let generation = state["generation"] as? Int else { return nil }
        return "\(owner):\(generation)"
      } ?? nil
    }
    AsyncFunction("acknowledge") { (key: String) -> Bool in WorkoutsShareStore.acknowledge(key) }
    AsyncFunction("discardCaptures") { (owner: String) throws in
      guard WorkoutsShareStore.discardOwner(owner) else { throw NSError(domain: WorkoutsShareStore.service, code: 4) }
    }
    AsyncFunction("clearSession") { () async throws in
      let old = try WorkoutsShareStore.withLock { defaults, container -> ([String: Any]?, String?) in
        let token = WorkoutsShareStore.token()
        // Revoke before reading the journal: corruption or protection failures
        // must not leave an import capability usable after account sign-out.
        try WorkoutsShareStore.setToken(nil)
        let d = try WorkoutsShareDefaults(defaults: defaults, container: container)
        let state = d.dictionary(forKey: WorkoutsShareStore.sessionKey)
        d.removeObject(forKey: WorkoutsShareStore.sessionKey)
        guard d.synchronize() else { throw NSError(domain: WorkoutsShareStore.service, code: 8) }
        return (state, token)
      }
      guard let old else {
        try WorkoutsShareStore.setToken(nil)
        throw NSError(domain: WorkoutsShareStore.service, code: 2)
      }
      guard let state = old.0, let token = old.1, let base = state["apiBaseURL"] as? String,
        let url = WorkoutsShareStore.baseURL(base) else { return }
      var request = URLRequest(url: url.appendingPathComponent("api/v1/workouts/share/session"))
      request.httpMethod = "DELETE"; request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
      let session = WorkoutsShareStore.network(); defer { session.finishTasksAndInvalidate() }
      _ = try? await session.data(for: request)
    }
  }
}

enum CaptureImageNormalizer {
  static func write(_ source: String, to destination: String, cacheDirectory: URL) throws {
    let cache = cacheDirectory.resolvingSymlinksInPath()
      .appendingPathComponent("hafa-workouts-capture", isDirectory: true).standardizedFileURL
    guard let input = URL(string: source), input.isFileURL, input.host == nil || input.host == "",
      input.query == nil, input.fragment == nil,
      let output = URL(string: destination), output.isFileURL, output.host == nil || output.host == "",
      output.query == nil, output.fragment == nil,
      output.deletingLastPathComponent().standardizedFileURL.resolvingSymlinksInPath() == cache,
      output.pathExtension == "jpg",
      !FileManager.default.fileExists(atPath: output.path),
      let image = CGImageSourceCreateWithURL(input as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else {
      throw NSError(domain: WorkoutsShareStore.service, code: 6,
        userInfo: [NSLocalizedDescriptionKey: "Choose an available, readable workout image."])
    }
    var result: Data?
    for limit in [1600, 1200, 900] {
      let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: limit,
        kCGImageSourceShouldCacheImmediately: true]
      guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(image, 0, options as CFDictionary) else { break }
      let bytes = NSMutableData()
      guard let encoder = CGImageDestinationCreateWithData(bytes, UTType.jpeg.identifier as CFString, 1, nil) else { break }
      CGImageDestinationAddImage(encoder, thumbnail, [kCGImageDestinationLossyCompressionQuality: 0.65] as CFDictionary)
      guard CGImageDestinationFinalize(encoder) else { break }
      result = bytes as Data
      if bytes.length <= 300 * 1024 { break }
    }
    guard let result else {
      throw NSError(domain: WorkoutsShareStore.service, code: 6,
        userInfo: [NSLocalizedDescriptionKey: "That workout image could not be converted. Choose another image."])
    }
    guard result.count <= 350 * 1024 else {
      throw NSError(domain: WorkoutsShareStore.service, code: 7,
        userInfo: [NSLocalizedDescriptionKey: "That image is still too large. Crop the workout or use clearer screenshots."])
    }
    // Write only the already-journaled destination, including a partial write.
    // Atomic writes can create an unregistered temporary sibling on interruption.
    try result.write(to: output, options: .withoutOverwriting)
  }
}
