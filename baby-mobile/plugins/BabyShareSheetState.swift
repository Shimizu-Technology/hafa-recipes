import Foundation

// Every message the share card can show, with the rule for choosing it. Foundation only, so it runs
// on a Mac in the native tests. The words never say "source", "original", "import" or "processed".
// `saving` and `stillWorking` are the card's busy states; the rest are what it says once it's done.
enum BabyShareSheetState: Equatable {
  case saving, saved, organizing, family, waiting, notSignedIn, notConnected, stillWorking
  case failed, tooBig, tooManyPhotos, oneLink, oneAtATime, unsupported, locked

  struct Words: Equatable {
    let title: String
    let detail: String?
    // Only an answer with nothing left to do closes on its own. Anything with a next step waits for Done.
    let closesItself: Bool
  }

  // A provider can stall and never answer, and nothing else ends the wait. This soon she's offered Stop, which is long
  // enough that a link or a photo never sees it. Work carries on behind it, so a slow video isn't cut off by this.
  static let stillWorkingAfter: TimeInterval = 12
  // The largest file taken is 25 MB, which is 3 minutes at about 1.1 Mbps. Anything still going by then is either stuck
  // or far bigger than can be taken once it does arrive, so this ends it rather than spin for ever.
  static let giveUpAfter: TimeInterval = 180
  static let openApp = "Open Håfa Baby"
  static let tryAgain = "Try again"
  // Save's write normally takes a moment. One still going after this is called slow: Close is allowed again, and only keeps.
  static let publishTimeout: TimeInterval = 12

  // How Save ended. `failed` and `slow` happened after Save was marked on the phone, so the app can finish it. `notKept` is the
  // mark itself failing: nothing can be promised. `gone` is the account or its space cleared meanwhile, which takes the share.
  // `slowUnmarked` is slow before the mark is down: nothing is promised yet.
  enum Publication: Equatable { case kept, failed, notKept, gone, slow, slowUnmarked }

  // Failed stays on the card, as in Recipes: Save becomes Try again, the kit adds Discard share, and ✕ keeps it.
  // After Save was marked, closing keeps it and the app finishes it.
  static let saveFailedNote = "Couldn’t finish saving. Try again, or close and we’ll finish saving it when you open Håfa Baby."
  // Nothing at all could be written. No promise.
  static let saveNotKeptNote = "Couldn’t save this. Nothing could be kept on this phone. Try again, or choose Discard share."
  // Slow before Save is marked on the phone: honest that it might not be kept.
  static let saveSlowUnmarked = HafaShareOutcome(symbol: "hourglass", title: "Still saving",
    detail: "Keep this open a moment, or close and share it again.", primary: "Close")
  // Discard found the app had already finished it.
  static let alreadySaved = HafaShareOutcome(symbol: "checkmark", title: "Already saved to Håfa Baby",
    detail: "Håfa Baby finished saving it, so there was nothing to discard.", primary: "Done")
  // Slow once Save is marked: the write is still going, and the app finishes it whichever way it ends.
  static let saveSlow = HafaShareOutcome(symbol: "iphone", title: "Still saving",
    detail: "We’ll finish saving this when you open Håfa Baby.", primary: "Done", secondary: openApp, opens: .secondary)

  var words: Words {
    switch self {
    case .saving: return Words(title: "Saving…", detail: nil, closesItself: false)
    case .saved: return Words(title: "Saved to Håfa Baby", detail: "Only you can see it.", closesItself: true)
    case .organizing: return Words(title: "Saved to Håfa Baby", detail: "We’ll organize it for you soon.", closesItself: true)
    // "Parents" on purpose: a family's caregivers can't see its saved posts.
    case .family: return Words(title: "Saved for your family", detail: "Parents in your family can see it.", closesItself: true)
    case .waiting: return Words(title: "Saved on this phone", detail: "It’ll finish saving when you open Håfa Baby. Kept on this phone for 30 days.", closesItself: false)
    case .notSignedIn: return Words(title: "You’re not signed in", detail: "We kept this on your phone for 30 days, in no one’s account. Open Håfa Baby and sign in to add it.", closesItself: false)
    case .notConnected: return Words(title: "Saved on this phone", detail: "Open Håfa Baby to add it within 30 days.", closesItself: false)
    // Nothing here says anything's saved, because nothing is yet.
    case .stillWorking: return Words(title: "Still working on this", detail: "You can close this and share it again later.", closesItself: false)
    case .failed: return Words(title: "Couldn’t save this", detail: "Try sharing it again.", closesItself: false)
    case .tooBig: return Words(title: "This file is too big", detail: "Håfa Baby takes files up to 25 MB.", closesItself: false)
    case .tooManyPhotos: return Words(title: "Too many photos", detail: "Share up to 4 at a time.", closesItself: false)
    case .oneLink: return Words(title: "One link at a time", detail: "Share them one by one.", closesItself: false)
    case .oneAtATime: return Words(title: "One thing at a time", detail: "Share them one by one.", closesItself: false)
    case .unsupported: return Words(title: "This kind of file won’t work", detail: "Håfa Baby takes links, photos, videos, PDFs and audio.", closesItself: false)
    case .locked: return Words(title: "Your phone locked", detail: "Unlock it and share this again.", closesItself: false)
    }
  }

  // What became of a capture that's safely on the phone. `scope` is the tag it got when the share began, not
  // whatever the Keychain says now: one started before an account connected belongs to no one, and has to say so.
  // `status` is the API's answer, if there was one. `signedIn` is the app having seen a sign-in on this phone,
  // so someone whose connection hasn't arrived yet isn't told they're signed out.
  static func after(scope: String?, signedIn: Bool, status: String?) -> BabyShareSheetState {
    guard let scope else { return signedIn ? .notConnected : .notSignedIn }
    guard let status else { return .waiting }
    // Who can see it matters more than that it'll be organized.
    if isFamily(scope) { return .family }
    return status == "saved" ? .saved : .organizing
  }

  // What the card shows once it's done, or nil while it's still busy. `category` is the one she chose, and `filed` is the
  // API saying it went there. One kept on the phone hasn't been filed yet, and Håfa Baby files it when it adds it.
  func outcome(category: String? = nil, filed: Bool = false) -> HafaShareOutcome? {
    let words = words
    switch self {
    case .saving, .stillWorking: return nil
    case .saved, .organizing, .family:
      let missed = category != nil && !filed
      return HafaShareOutcome(symbol: self == .family ? "person.2" : "checkmark",
        title: filed ? "Added to \(category ?? "")" : words.title,
        detail: missed ? "It couldn’t go in \(category ?? ""), so it’s waiting in Saved for you to organize." : words.detail,
        primary: "Done", secondary: Self.openApp, opens: .secondary, closesItself: !missed)
    case .waiting, .notConnected:
      return HafaShareOutcome(symbol: "iphone", title: words.title, detail: words.detail, primary: Self.openApp, secondary: "Done", opens: .primary)
    case .notSignedIn:
      return HafaShareOutcome(symbol: "person.crop.circle", title: words.title, detail: words.detail, primary: Self.openApp, secondary: "Later", opens: .primary)
    case .failed, .tooBig, .tooManyPhotos, .oneLink, .oneAtATime, .unsupported, .locked:
      let symbol: String
      switch self {
      case .tooBig, .unsupported: symbol = "doc"
      case .tooManyPhotos: symbol = "photo.on.rectangle"
      case .oneLink, .oneAtATime: symbol = "link"
      case .locked: symbol = "lock"
      default: symbol = "exclamationmark"
      }
      return HafaShareOutcome(symbol: symbol, isProblem: true, title: words.title, detail: words.detail, primary: "Close")
    }
  }

  var isProblem: Bool {
    switch self {
    case .failed, .tooBig, .tooManyPhotos, .oneLink, .oneAtATime, .unsupported, .locked: return true
    default: return false
    }
  }

  // What the API takes: ALLOWED in api/app/domains/baby/attachments.py, which a test reads so the two can't drift. Apple
  // and other apps name some of these differently, and the same container gets the API's name before anything is stored.
  // Anything else is refused here, because the API would refuse it for ever and it would never be delivered.
  static let fileTypes: Set<String> = [
    "image/jpeg", "image/heic", "image/heif", "image/png", "image/webp", "image/gif", "application/pdf",
    "video/mp4", "video/quicktime", "video/webm",
    "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg",
  ]
  private static let aliases = [
    "image/jpg": "image/jpeg", "audio/mp3": "audio/mpeg", "audio/x-mp3": "audio/mpeg", "audio/x-m4a": "audio/mp4", "audio/m4a": "audio/mp4",
    "audio/vnd.wave": "audio/wav", "audio/wave": "audio/wav",
  ]
  private static let fileExtensions = [
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif", "heic": "image/heic", "heif": "image/heif",
    "pdf": "application/pdf", "mp4": "video/mp4", "mov": "video/quicktime", "webm": "video/webm", "mp3": "audio/mpeg", "m4a": "audio/mp4", "wav": "audio/wav", "ogg": "audio/ogg",
  ]
  // The name the API knows this file by, or nil if it won't take it. The same rule as lib/file-type.ts.
  static func canonicalMime(_ mimeType: String?, name: String?) -> String? {
    let mime = mimeType?.components(separatedBy: ";")[0].trimmingCharacters(in: .whitespaces).lowercased() ?? ""
    if !mime.isEmpty, mime != "application/octet-stream" {
      let canonical = aliases[mime] ?? mime
      return fileTypes.contains(canonical) ? canonical : nil
    }
    return fileExtensions[name?.components(separatedBy: ".").last?.lowercased() ?? ""]
  }
  // Asked before a file is copied. What can't be delivered must never get into the queue. The 25 MB is lib/files.ts's and the API's.
  static let maxFileBytes = 25 * 1024 * 1024
  static func refusal(mimeType: String?, name: String?, size: Int?) -> BabyShareSheetState? {
    guard canonicalMime(mimeType, name: name) != nil else { return .unsupported }
    if let size, size > maxFileBytes { return .tooBig }
    return nil
  }

  // `owner:generation:personal`, `owner:generation:<family uuid>`, or `owner:generation` from before spaces.
  static func isFamily(_ scope: String) -> Bool {
    let parts = scope.components(separatedBy: ":")
    return parts.count > 2 && UUID(uuidString: parts[parts.count - 1]) != nil
  }
}
