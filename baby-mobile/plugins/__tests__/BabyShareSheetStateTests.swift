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
    let refusal = BabyShareSheetState.refusal, limit = 25 * 1024 * 1024
    try check(refusal("video/quicktime", "a.mov", limit) == nil, "exactly 25 MB fits, as the app and API allow")
    try check(refusal("video/quicktime", "a.mov", limit + 1) == .tooBig, "one byte over is refused")
    try check(refusal("application/pdf", "a.pdf", limit + 1) == .tooBig, "a PDF over too")
    try check(refusal("video/mp4", "a.mp4", nil) == nil, "an unknown size is checked after copying")
    for (mime, name) in [("text/plain", "a.txt"), ("text/vcard", "a.vcf"), ("application/zip", "a.zip"), ("application/octet-stream", "a.docx"), ("application/octet-stream", "noextension"), ("application/vnd.apple.pkpass", "a.pkpass")] {
      try check(refusal(mime, name, 10) == .unsupported, "\(name) is refused as the app would")
      try check(refusal(mime, name, limit * 2) == .unsupported, "\(name) is unsupported before it's big")
    }
    for (mime, name) in [("image/jpeg", "a.jpg"), ("video/webm", "a.webm"), ("audio/mp4; codecs=aac", "a.m4a"), ("application/pdf", "a.pdf"), ("application/octet-stream", "a.PDF"), ("application/octet-stream", "a.m4v"), (nil, "a.ogg")] as [(String?, String)] {
      try check(refusal(mime, name, 10) == nil, "\(name) is taken as the app would")
    }
    let closing: [BabyShareSheetState] = [.saved, .organizing, .family], staying: [BabyShareSheetState] = [.saving, .stillWorking, .waiting, .notSignedIn, .notConnected, .failed, .tooBig, .tooManyPhotos, .oneLink, .oneAtATime, .unsupported, .locked]
    for state in closing { try check(state.words.closesItself, "\(state) closes itself") }
    for state in staying { try check(!state.words.closesItself, "\(state) waits for Done") }
    let every = closing + staying
    for state in every {
      let words = state.words.title + " " + (state.words.detail ?? "")
      for banned in ["Private to your", "source", "original", "import", "processed", "Error", "online"] {
        try check(!words.contains(banned), "\(state) doesn't say \(banned)")
      }
    }
    for state in [BabyShareSheetState.failed, .tooBig, .tooManyPhotos, .oneLink, .oneAtATime, .unsupported, .locked] { try check(state.isProblem, "\(state) looks like a problem") }
    for state in closing + [.saving, .stillWorking, .waiting, .notSignedIn, .notConnected] { try check(!state.isProblem, "\(state) isn't a problem") }
    try check(BabyShareSheetState.locked.words.detail == "Unlock it and share this again.", "locked says what to do")
    try check(BabyShareSheetState.stillWorking.buttonTitle == "Stop" && BabyShareSheetState.failed.buttonTitle == "Done", "the way out says what it does")
    try check(!BabyShareSheetState.stillWorking.words.title.contains("Saved"), "still working promises nothing")
    try check(BabyShareSheetState.notSignedIn.words.title == "You’re not signed in", "signed out says so")
    try check(BabyShareSheetState.family.words.detail == "Parents in your family can see it.", "family says who")
    print("\(count) native sheet state cases passed")
  }
}
