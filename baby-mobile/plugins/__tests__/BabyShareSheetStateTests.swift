import Foundation

@main
struct BabyShareSheetStateTests {
  static func main() throws {
    var count = 0
    func check(_ condition: Bool, _ label: String) throws {
      guard condition else { throw NSError(domain: label, code: count) }; count += 1
    }
    let family = "11111111-1111-4111-8111-111111111111"
    let after = BabyShareSheetState.after
    // Signed out, never opened, and a capture from before the account connected are all no one's.
    try check(after(nil, false, nil) == .notSignedIn, "no owner, no sign-in seen")
    try check(after(nil, true, nil) == .notConnected, "no owner, sign-in seen, is never told it's signed out")
    try check(after(nil, false, "saved") == .notSignedIn, "the tag decides, even with a stray status")
    // Offline, expired, revoked, a timeout and any file have no status, under any tag.
    for tag in ["owner:1", "owner:1:personal", "owner:1:\(family)"] {
      try check(after(tag, true, nil) == .waiting, "\(tag) not delivered waits on the phone")
      try check(after(tag, false, nil) == .waiting, "\(tag) not delivered is unaffected by the sign-in hint")
    }
    for tag in ["owner:1", "owner:1:personal", "own:er:1:personal"] {
      try check(after(tag, true, "saved") == .saved, "\(tag) saved is personal")
      try check(after(tag, true, "queued") == .organizing, "\(tag) queued is being organized")
      try check(after(tag, true, "deferred") == .organizing, "\(tag) deferred is being organized")
    }
    for status in ["saved", "queued", "deferred"] {
      try check(after("owner:1:\(family)", true, status) == .family, "family outranks organizing on \(status)")
    }
    for state in [BabyShareSheetState.waiting, .notSignedIn, .notConnected] {
      try check(state.words.detail?.contains("30 days") == true, "phone-only retention is disclosed before sign-in")
    }
    let closing: [BabyShareSheetState] = [.saved, .organizing, .family], staying: [BabyShareSheetState] = [.saving, .waiting, .notSignedIn, .notConnected]
    for state in closing { try check(state.words.closesItself, "\(state) closes itself") }
    for state in staying { try check(!state.words.closesItself, "\(state) waits for Done") }
    let every = closing + staying
    for state in every {
      let words = state.words.title + " " + (state.words.detail ?? "")
      for banned in ["Private to your", "source", "original", "import", "processed", "Error", "online"] {
        try check(!words.contains(banned), "\(state) doesn't say \(banned)")
      }
    }
    try check(BabyShareSheetState.notSignedIn.words.title == "You’re not signed in", "signed out says so")
    try check(BabyShareSheetState.family.words.detail == "Parents in your family can see it.", "family says who")
    print("\(count) native sheet state cases passed")
  }
}
