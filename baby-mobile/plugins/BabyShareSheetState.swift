import Foundation

// Every message the share sheet can show, with the rule for choosing it. Foundation only, so it runs
// on a Mac in the native tests. The words never say "source", "original", "import" or "processed".
enum BabyShareSheetState: Equatable {
  case saving, saved, organizing, family, waiting, notSignedIn, notConnected

  struct Words: Equatable {
    let title: String
    let detail: String?
    // Only an answer with nothing left to do closes on its own. Anything with a next step waits for Done.
    let closesItself: Bool
  }

  var words: Words {
    switch self {
    case .saving: return Words(title: "Saving…", detail: nil, closesItself: false)
    case .saved: return Words(title: "Saved to Håfa Baby", detail: "Only you can see it.", closesItself: true)
    case .organizing: return Words(title: "Saved to Håfa Baby", detail: "We’ll organize it for you soon.", closesItself: true)
    // "Parents" on purpose: a family's caregivers can't see its saved posts.
    case .family: return Words(title: "Saved for your family", detail: "Parents in your family can see it.", closesItself: true)
    case .waiting: return Words(title: "Saved on this phone", detail: "It’ll finish saving when you open Håfa Baby.", closesItself: false)
    case .notSignedIn: return Words(title: "You’re not signed in", detail: "We kept this on your phone, in no one’s account. Open Håfa Baby and sign in to add it.", closesItself: false)
    case .notConnected: return Words(title: "Saved on this phone", detail: "Open Håfa Baby to add it.", closesItself: false)
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
