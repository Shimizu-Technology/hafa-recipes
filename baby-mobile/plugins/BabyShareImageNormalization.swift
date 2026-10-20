import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// The API converts image attachments to an upright still image. Match that
// contract here: first frame, JPEG for opaque content, PNG when alpha is present.
// Decode thumbnails rather than allocating full-resolution photo pixel buffers.
enum BabyShareImageNormalization {
  static let maxInputBytes = 25 * 1024 * 1024
  static let maxOutputBytes = 8 * 1024 * 1024
  static let maxOutputDimension = 2_048
  static let maxInputDimension = 12_000
  static let maxInputPixels = 60_000_000
  enum InvalidImage: Error { case invalid }

  struct Image {
    let bytes: Data
    let fileExtension: String
    let mimeType: String
    let width: Int
    let height: Int
  }

  static func validateDimensions(width: Int, height: Int) throws {
    guard width > 0, height > 0,
      width <= maxInputDimension, height <= maxInputDimension,
      width * height <= maxInputPixels
    else { throw InvalidImage.invalid }
  }

  static func normalize(fileURL: URL) throws -> Image {
    guard fileURL.isFileURL,
      let size = try fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize,
      size > 0, size <= maxInputBytes
    else { throw InvalidImage.invalid }
    let handle = try FileHandle(forReadingFrom: fileURL)
    defer { try? handle.close() }
    // Bound the read too, so a changing provider file cannot bypass stat.
    guard let bytes = try handle.read(upToCount: maxInputBytes + 1)
    else { throw InvalidImage.invalid }
    return try normalize(bytes: bytes)
  }

  static func normalize(bytes: Data) throws -> Image {
    guard !bytes.isEmpty, bytes.count <= maxInputBytes,
      let source = CGImageSourceCreateWithData(bytes as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
      CGImageSourceGetStatus(source) == .statusComplete, CGImageSourceGetCount(source) > 0,
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? Int,
      let height = properties[kCGImagePropertyPixelHeight] as? Int
    else { throw InvalidImage.invalid }
    try validateDimensions(width: width, height: height)
    var maximum = maxOutputDimension
    while maximum >= 256 {
      guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maximum,
        kCGImageSourceShouldCacheImmediately: true,
      ] as CFDictionary)
      else { throw InvalidImage.invalid }
      if let output = try encode(image: image) { return output }
      maximum = maximum * 3 / 4
    }
    throw InvalidImage.invalid
  }

  // UIKit's bounded renderer supplies an already-upright CGImage for providers
  // that return UIImage instead of encoded bytes or a local file URL.
  static func normalize(image: CGImage) throws -> Image {
    guard image.width > 0, image.height > 0,
      image.width <= maxOutputDimension, image.height <= maxOutputDimension
    else { throw InvalidImage.invalid }
    var current = image, maximum = max(image.width, image.height)
    while maximum >= 1 {
      if let output = try encode(image: current) { return output }
      maximum = maximum * 3 / 4
      guard maximum >= 256 else { break }
      let scale = CGFloat(maximum) / CGFloat(max(image.width, image.height))
      let width = max(1, Int(CGFloat(image.width) * scale)), height = max(1, Int(CGFloat(image.height) * scale))
      let alpha = image.alphaInfo == .none || image.alphaInfo == .noneSkipFirst || image.alphaInfo == .noneSkipLast
        ? CGImageAlphaInfo.noneSkipLast : CGImageAlphaInfo.premultipliedLast
      guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: alpha.rawValue)
      else { throw InvalidImage.invalid }
      context.interpolationQuality = .high
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
      guard let resized = context.makeImage() else { throw InvalidImage.invalid }
      current = resized
    }
    throw InvalidImage.invalid
  }

  private static func encode(image: CGImage) throws -> Image? {
    let hasAlpha: Bool
    switch image.alphaInfo {
    case .none, .noneSkipFirst, .noneSkipLast: hasAlpha = false
    default: hasAlpha = true
    }
    let type = hasAlpha ? UTType.png : UTType.jpeg
    let output = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(output, type.identifier as CFString, 1, nil)
    else { throw InvalidImage.invalid }
    // Do not copy EXIF/GPS/source metadata. Thumbnail transform baked orientation
    // into pixels; the new image is upright and must not be rotated a second time.
    CGImageDestinationAddImage(destination, image, [
      kCGImagePropertyOrientation: 1,
      kCGImageDestinationLossyCompressionQuality: 0.88,
    ] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { throw InvalidImage.invalid }
    guard output.length > 0, output.length <= maxOutputBytes else { return nil }
    return Image(bytes: output as Data, fileExtension: hasAlpha ? "png" : "jpg",
      mimeType: hasAlpha ? "image/png" : "image/jpeg", width: image.width, height: image.height)
  }
}
