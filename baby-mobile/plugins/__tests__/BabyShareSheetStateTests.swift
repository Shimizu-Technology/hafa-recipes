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
    let refusal = BabyShareSheetState.refusal, limit = 25 * 1024 * 1024, canonical = BabyShareSheetState.canonicalMime
    try check(refusal("video/quicktime", "a.mov", limit) == nil, "exactly 25 MB fits, as the app and API allow")
    try check(refusal("video/quicktime", "a.mov", limit + 1) == .tooBig, "one byte over is refused")
    try check(refusal("application/pdf", "a.pdf", limit + 1) == .tooBig, "a PDF over too")
    try check(refusal("video/mp4", "a.mp4", nil) == nil, "an unknown size is checked after copying")
    // Apple's own answers, seen from UTType on 2026-11-07: .m4a is audio/x-m4a, .wav is audio/vnd.wave.
    try check(canonical("audio/x-m4a", "a.m4a") == "audio/mp4", ".m4a gets the name the API takes")
    try check(canonical("audio/vnd.wave", "a.wav") == "audio/wav", ".wav too")
    try check(canonical("audio/mp4; codecs=aac", "a.m4a") == "audio/mp4", "parameters don't matter")
    try check(canonical("IMAGE/JPG", nil) == "image/jpeg", "nor case")
    for (mime, name) in [("text/plain", "a.txt"), ("text/vcard", "a.vcf"), ("application/zip", "a.zip"), ("application/octet-stream", "a.docx"), ("application/octet-stream", "noextension"), ("application/vnd.apple.pkpass", "a.pkpass"),
      ("audio/aac", "a.aac"), ("video/3gpp", "a.3gp"), ("video/x-m4v", "a.m4v"), ("application/octet-stream", "a.aac"), ("application/octet-stream", "a.3gp"), ("application/octet-stream", "a.m4v"), ("image/tiff", "a.tiff"), ("audio/aiff", "a.aiff"), ("application/zip", "fake.jpg")] {
      try check(refusal(mime, name, 10) == .unsupported, "\(name) as \(mime) is refused, since the API would")
      try check(refusal(mime, name, limit * 2) == .unsupported, "\(name) is unsupported before it's big")
    }
    for mime in BabyShareSheetState.fileTypes {
      try check(canonical(mime, nil) == mime, "\(mime) stays what the API calls it")
    }
    for (mime, name) in [("image/jpeg", "a.jpg"), ("video/webm", "a.webm"), ("audio/mp4; codecs=aac", "a.m4a"), ("application/pdf", "a.pdf"), ("application/octet-stream", "a.PDF"), ("application/octet-stream", "a.mov"), (nil, "a.ogg")] as [(String?, String)] {
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
    // The card's endings: what's done closes itself, anything with a next step waits, and opening the app is offered.
    try check(BabyShareSheetState.saving.outcome() == nil && BabyShareSheetState.stillWorking.outcome() == nil, "busy states aren't endings")
    let saved = BabyShareSheetState.saved.outcome()!
    try check(saved.title == "Saved to Håfa Baby" && saved.detail == "Only you can see it." && saved.closesItself && saved.opens == .secondary, "saved privately")
    let filed = BabyShareSheetState.saved.outcome(category: "Sleep", filed: true)!
    try check(filed.title == "Added to Sleep" && filed.detail == "Only you can see it." && filed.closesItself, "filed where she chose")
    let missed = BabyShareSheetState.organizing.outcome(category: "Sleep", filed: false)!
    try check(missed.title == "Saved to Håfa Baby" && missed.detail?.contains("couldn’t go in Sleep") == true && !missed.closesItself, "a category that didn't take is said, and waits to be read")
    try check(BabyShareSheetState.family.outcome(category: "Sleep", filed: true)!.detail == "Parents in your family can see it.", "family still says who")
    for state in [BabyShareSheetState.waiting, .notConnected, .notSignedIn] {
      let outcome = state.outcome()!
      try check(outcome.primary == "Open Håfa Baby" && outcome.opens == .primary && !outcome.closesItself, "\(state) offers the app")
    }
    for state in [BabyShareSheetState.failed, .tooBig, .tooManyPhotos, .oneLink, .oneAtATime, .unsupported, .locked] {
      let outcome = state.outcome()!
      try check(outcome.isProblem && outcome.opens == nil && outcome.primary == "Close", "\(state) is a problem with one way out")
    }

    // Before Save: what it is, who'll see it, and where it goes.
    let rows = { (rows: [[String: String]]) in try! JSONSerialization.data(withJSONObject: rows) }
    let reel = BabyShareWords.describe(rows([["url": "https://www.instagram.com/reel/abc/", "meta": #"{"og:title":"Nurse on Instagram: \"Latch tips\nmore\""}"#]]))
    try check(reel.title == "Latch tips" && reel.subtitle == "Nurse · Instagram" && reel.link != nil, "a reel shows its caption and who made it")
    try check(BabyShareWords.describe(rows([["url": "https://vm.tiktok.com/x/"]])).title == "Post from TikTok", "a bare link names the site")
    try check(BabyShareWords.describe(["Read this https://example.com/a today"]).link?.host == "example.com", "the one link in text")
    try check(BabyShareWords.describe(["Two https://a.com and https://b.com"]).link == nil, "two links aren't guessed between")
    try check(BabyShareWords.describe(["Feeding plan\nline two"]).title == "Feeding plan", "text shows its first line")
    let photos = BabyShareWords.describe(rows([["path": "file:///tmp/a.jpg", "mimeType": "image/jpeg", "fileName": "Image.jpg"], ["path": "file:///tmp/b.jpg", "mimeType": "image/jpeg"]]))
    try check(photos.title == "2 photos" && photos.photo?.path == "/tmp/a.jpg", "photos count, and the first is the thumbnail")
    try check(BabyShareWords.describe(rows([["path": "file:///tmp/x.pdf", "mimeType": "application/pdf", "fileName": "Discharge notes.pdf"]])).title == "Discharge notes", "a PDF by its name")
    try check(BabyShareWords.describe(rows([["path": "https://example.com/a.jpg", "mimeType": "image/jpeg"]])).photo == nil, "only a file on the phone is opened")
    let items = [["id": "a", "title": "Sleep"], ["id": "b", "title": "Feeding"]]
    let choice = BabyShareWords.categoryChoice(items, selected: BabyShareWords.later)!
    try check(choice.options.map(\.title) == ["Organize later", "Sleep", "Feeding"] && choice.selected == "later" && choice.style == .chips, "Organize later first, and chosen")
    try check(BabyShareWords.categoryChoice([], selected: "later") == nil, "no categories, no choice")
    try check(BabyShareWords.note(scope: "owner:1:personal", category: nil) == "Only you can see it. You can organize it later.", "private by default")
    try check(BabyShareWords.note(scope: "owner:1:\(family)", category: "Sleep") == "Parents in your family can see it. It’ll go in Sleep.", "family says who, and where")
    try check(BabyShareWords.note(scope: nil, category: nil) == nil && BabyShareWords.notice(scope: "owner:1", signedIn: true) == nil, "the notice is only for no owner")
    try check(BabyShareWords.notice(scope: nil, signedIn: false)?.text.contains("not signed in") == true, "signed out is said before Save")
    try check(BabyShareWords.notice(scope: nil, signedIn: true)?.text.contains("not signed in") == false, "a sign-in still connecting isn't told it's signed out")

    // The phone only asks an ordinary public page for its title.
    let fetch = { (link: String) in HafaSharePreviewText.mayFetchPreview(URL(string: link)!) }
    for link in ["https://www.instagram.com/reel/abc/?igsh=xyz", "https://www.tiktok.com/@a/video/1", "http://example.com/a?page=2"] {
      try check(fetch(link), "\(link) may be asked")
    }
    for link in ["https://user:pw@example.com/", "https://example.com/a?token=1", "https://example.com/a?access_token=1", "https://example.com/a?X-Amz-Signature=1",
      "https://example.com/a#access_token=1", "https://example.com/a?sig=1", "https://localhost/a", "https://printer.local/", "http://192.168.1.4/",
      "http://[::1]/", "https://hafa-recipes.com/r/abc", "https://www.hafa-recipes.com/r/abc", "ftp://example.com/", "file:///tmp/a", "https://intranet/"] {
      try check(!fetch(link), "\(link) is never asked")
    }
    try check(!BabyShareSheetState.stillWorking.words.title.contains("Saved"), "still working promises nothing")
    try check(BabyShareSheetState.notSignedIn.words.title == "You’re not signed in", "signed out says so")
    try check(BabyShareSheetState.family.words.detail == "Parents in your family can see it.", "family says who")
    print("\(count) native sheet state cases passed")
  }
}
