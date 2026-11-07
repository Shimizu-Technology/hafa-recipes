import Foundation

// Every message the share sheet can show, with the rule for choosing it. Foundation only, so it runs
// on a Mac in the native tests. The words never say "source", "original", "import" or "processed".
enum BabyShareSheetState: Equatable {
  case saving, saved, organizing, family, waiting, notSignedIn, notConnected, stillWorking, failed

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
  var buttonTitle: String { self == .stillWorking ? "Stop" : "Done" }

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
    case .stillWorking: return Words(title: "Still working on this", detail: "You can stop and share it again later.", closesItself: false)
    case .failed: return Words(title: "Couldn’t save this", detail: "Try sharing it again.", closesItself: false)
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

  // `owner:generation:personal`, `owner:generation:<family uuid>`, or `owner:generation` from before spaces.
  private static func isFamily(_ scope: String) -> Bool {
    let parts = scope.components(separatedBy: ":")
    return parts.count > 2 && UUID(uuidString: parts[parts.count - 1]) != nil
  }
}
