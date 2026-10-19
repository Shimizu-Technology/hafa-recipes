import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

@main
struct BabyShareImageNormalizationTests {
  static func main() throws {
    enum Failure: Error { case fixture, contract }
    var cases = 0
    func check(_ value: Bool) throws { if !value { throw Failure.contract } }
    func image(width: Int = 64, height: Int = 32, alpha: Bool = false) throws -> CGImage {
      guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: (alpha ? CGImageAlphaInfo.premultipliedLast : CGImageAlphaInfo.noneSkipLast).rawValue)
      else { throw Failure.fixture }
      for (x, y, red, green, blue) in [(0, 0, 1.0, 0.0, 0.0), (1, 0, 0.0, 1.0, 0.0),
                                      (0, 1, 0.0, 0.0, 1.0), (1, 1, 1.0, 1.0, 0.0)] {
        context.setFillColor(red: red, green: green, blue: blue, alpha: alpha ? 0.5 : 1)
        context.fill(CGRect(x: x * width / 2, y: y * height / 2, width: width / 2, height: height / 2))
      }
      guard let value = context.makeImage() else { throw Failure.fixture }
      return value
    }
    func fixture(_ type: UTType, image: CGImage, orientation: Int = 1) throws -> Data {
      let data = NSMutableData()
      guard let destination = CGImageDestinationCreateWithData(data, type.identifier as CFString, 1, nil)
      else { throw Failure.fixture }
      CGImageDestinationAddImage(destination, image, [kCGImagePropertyOrientation: orientation,
        kCGImagePropertyGPSDictionary: [kCGImagePropertyGPSLatitude: 13.4,
          kCGImagePropertyGPSLatitudeRef: "N"]] as CFDictionary)
      guard CGImageDestinationFinalize(destination) else { throw Failure.fixture }
      return data as Data
    }
    func decoded(_ output: BabyShareImageNormalization.Image) throws -> (CGImage, [CFString: Any]) {
      guard let source = CGImageSourceCreateWithData(output.bytes as CFData, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
        let type = CGImageSourceGetType(source),
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
      else { throw Failure.contract }
      try check(["image/jpeg", "image/png"].contains(output.mimeType))
      try check((type as String) == (output.mimeType == "image/png" ? UTType.png.identifier : UTType.jpeg.identifier))
      try check(output.width == image.width && output.height == image.height)
      try check(max(image.width, image.height) <= BabyShareImageNormalization.maxOutputDimension)
      try check(output.bytes.count <= BabyShareImageNormalization.maxOutputBytes)
      try check(properties[kCGImagePropertyGPSDictionary] == nil)
      try check((properties[kCGImagePropertyOrientation] as? Int ?? 1) == 1)
      return (image, properties)
    }
    func pixel(_ image: CGImage, x: Int, y: Int) throws -> [UInt8] {
      var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
      let ok = bytes.withUnsafeMutableBytes { buffer -> Bool in
        guard let context = CGContext(data: buffer.baseAddress, width: image.width, height: image.height,
          bitsPerComponent: 8, bytesPerRow: image.width * 4, space: CGColorSpaceCreateDeviceRGB(),
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        return true
      }
      try check(ok)
      let first = (y * image.width + x) * 4
      return Array(bytes[first..<(first + 4)])
    }
    let opaque = try image()
    // Real ImageIO HEIC/TIFF/BMP plus already accepted JPEG/PNG/GIF inputs.
    for type in [UTType.heic, .tiff, .bmp, .jpeg, .png, .gif] {
      let output = try BabyShareImageNormalization.normalize(bytes: fixture(type, image: opaque))
      _ = try decoded(output)
      try check(output.width == 64 && output.height == 32)
      cases += 1
    }
    // EXIF6 rotates TIFF pixels clockwise and writes upright PNG with alpha.
    let transparent = try image(alpha: true)
    let oriented = try BabyShareImageNormalization.normalize(bytes: fixture(.tiff, image: transparent, orientation: 6))
    let (rotated, _) = try decoded(oriented)
    try check(oriented.width == 32 && oriented.height == 64 && oriented.mimeType == "image/png")
    let originalBottomLeft = try pixel(transparent, x: 8, y: 24)
    let rotatedTopLeft = try pixel(rotated, x: 8, y: 8)
    try check(zip(originalBottomLeft, rotatedTopLeft).allSatisfy { abs(Int($0) - Int($1)) <= 2 })
    try check((120...135).contains(Int(rotatedTopLeft[3])))
    cases += 1
    // HEIC EXIF orientation must also be baked into resized output dimensions.
    let heic = try BabyShareImageNormalization.normalize(bytes: fixture(.heic, image: opaque, orientation: 6))
    _ = try decoded(heic)
    try check(heic.width == 32 && heic.height == 64)
    cases += 1
    let large = try image(width: 3_000, height: 2_000)
    let resized = try BabyShareImageNormalization.normalize(bytes: fixture(.tiff, image: large))
    _ = try decoded(resized)
    try check(resized.width <= 2_048 && resized.height < 2_000)
    cases += 1
    // High-entropy alpha pixels exceed8MiB at2048px. Both source and UIKit
    // bridges must reduce dimensions rather than enqueue an API-rejected file.
    var noise = Data(count: 2_048 * 2_048 * 4), seed: UInt32 = 12345
    noise.withUnsafeMutableBytes { buffer in
      for index in 0..<buffer.count {
        seed = seed &* 1664525 &+ 1013904223
        buffer[index] = UInt8(truncatingIfNeeded: seed >> 24)
      }
    }
    guard let provider = CGDataProvider(data: noise as CFData),
      let noisyImage = CGImage(width: 2_048, height: 2_048, bitsPerComponent: 8, bitsPerPixel: 32,
        bytesPerRow: 2_048 * 4, space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue), provider: provider,
        decode: nil, shouldInterpolate: true, intent: .defaultIntent)
    else { throw Failure.fixture }
    let bounded = try BabyShareImageNormalization.normalize(bytes: fixture(.tiff, image: noisyImage))
    _ = try decoded(bounded)
    try check(bounded.mimeType == "image/png" && bounded.width < 2_048)
    let boundedDirect = try BabyShareImageNormalization.normalize(image: noisyImage)
    _ = try decoded(boundedDirect)
    try check(boundedDirect.mimeType == "image/png" && boundedDirect.width < 2_048)
    cases += 2
    // The already-upright CGImage bridge used after UIKit's bounded renderer.
    let direct = try BabyShareImageNormalization.normalize(image: transparent)
    let (directImage, _) = try decoded(direct)
    try check(try pixel(directImage, x: 8, y: 8)[3] >= 120)
    cases += 1
    // Bound dimensions before thumbnail decode, while admitting48MP iPhone images.
    try BabyShareImageNormalization.validateDimensions(width: 8_064, height: 6_048)
    for dimensions in [(0, 1), (20_000, 1), (10_000, 10_000)] {
      do {
        try BabyShareImageNormalization.validateDimensions(width: dimensions.0, height: dimensions.1)
        throw Failure.contract
      } catch BabyShareImageNormalization.InvalidImage.invalid { cases += 1 }
    }
    for bytes in [Data([1, 2, 3]), Data(count: BabyShareImageNormalization.maxInputBytes + 1)] {
      do { _ = try BabyShareImageNormalization.normalize(bytes: bytes); throw Failure.contract }
      catch BabyShareImageNormalization.InvalidImage.invalid { cases += 1 }
    }
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let file = directory.appendingPathComponent("photo.heic")
    try fixture(.heic, image: opaque).write(to: file)
    _ = try decoded(BabyShareImageNormalization.normalize(fileURL: file))
    cases += 1
    let handle = try FileHandle(forWritingTo: file)
    try handle.truncate(atOffset: UInt64(BabyShareImageNormalization.maxInputBytes + 1))
    try handle.close()
    do { _ = try BabyShareImageNormalization.normalize(fileURL: file); throw Failure.contract }
    catch BabyShareImageNormalization.InvalidImage.invalid { cases += 1 }
    print("Baby image normalization: \(cases) native ImageIO cases passed")
  }
}
