import Foundation

// Everything the Recipes share card says, and the rule for choosing it. Foundation only, so it runs in the Mac tests.
// Picking Public here is the confirmation: a public link imports straight away, like a private one.
enum RecipeShareWords {
  enum Kind: Equatable { case link, photos(Int), text }
  enum Result: Equatable { case importing, importingPublic, alreadySaved, confirmPublic, review, signedOut, waiting }

  static let visibility = "visibility"
  static let action = "Save recipe"
  static let retry = "Try again"
  static let loading = "Getting it ready…"
  static let notKept = "Couldn’t keep this on your iPhone yet. Try again — nothing was lost."
  static let slow = "This is taking longer than usual. You can keep waiting or try again."
  static let signedOut = "You’re signed out. We’ll keep this on your iPhone until you sign in."

  static func visibilityChoice(isPublic: Bool) -> HafaShareChoice {
    HafaShareChoice(id: visibility, label: "Who can see it", style: .cards, options: [
      HafaShareOption(id: "private", title: "Private", detail: "Only you", symbol: "lock.fill"),
      HafaShareOption(id: "public", title: "Public", detail: "Anyone in Discover", symbol: "globe"),
    ], selected: isPublic ? "public" : "private")
  }

  // The one line under the choice says what happens next.
  static func note(isPublic: Bool, kind: Kind) -> String {
    switch (kind, isPublic) {
    case (.link, false): return "You can share it or make it public later."
    case (.link, true): return "Once it’s imported, anyone can find it in Discover. You can make it private later."
    case (_, false): return "You’ll check it in Håfa before it’s added."
    case (_, true): return "You’ll check it in Håfa and confirm before it goes public. Your photos stay private."
    }
  }

  static func fallbackTitle(site: String?) -> String { site.map { "Recipe from \($0)" } ?? "Shared recipe" }

  static func photosTitle(_ count: Int) -> String { count == 1 ? "1 photo" : "\(count) photos" }

  // A link from a signed-in phone is sent now. Everything else waits for Håfa, and says why.
  // needsApp: the server refused the public send (Discover's one-time agreement, or an older server); Håfa finishes it.
  // existing: the link was already a recipe here, which keeps its own visibility.
  static func result(kind: Kind, isPublic: Bool, signedIn: Bool, accepted: Bool, needsApp: Bool = false, existing: Bool = false) -> Result {
    guard signedIn else { return .signedOut }
    guard kind == .link else { return .review }
    if existing { return .alreadySaved }
    if accepted { return isPublic ? .importingPublic : .importing }
    return isPublic && needsApp ? .confirmPublic : .waiting
  }

  static func sendsNow(kind: Kind, isPublic: Bool, signedIn: Bool) -> Bool {
    kind == .link && signedIn
  }

  static func outcome(_ result: Result) -> HafaShareOutcome {
    switch result {
    case .importing:
      return HafaShareOutcome(symbol: "checkmark", title: "Saved to Håfa",
        detail: "We’re importing it now. It’ll be in your library in a minute or two.",
        primary: "Done", secondary: "Open Håfa", opens: .secondary, closesItself: true)
    case .importingPublic:
      return HafaShareOutcome(symbol: "checkmark", title: "Saved to Håfa",
        detail: "We’re importing it now. It’ll be in your library in a minute or two, and public once it’s complete.",
        primary: "Done", secondary: "Open Håfa", opens: .secondary, closesItself: true)
    case .alreadySaved:
      return HafaShareOutcome(symbol: "checkmark", title: "Already in your library",
        detail: "You saved this one before. Open Håfa to change who can see it.",
        primary: "Done", secondary: "Open Håfa", opens: .secondary)
    case .confirmPublic:
      return HafaShareOutcome(symbol: "globe", title: "One more step",
        detail: "Open Håfa to finish making it public. The import starts then.",
        primary: "Open Håfa", secondary: "Later", opens: .primary)
    case .review:
      return HafaShareOutcome(symbol: "text.viewfinder", title: "Saved — check it in Håfa",
        detail: "Open Håfa to look it over and add it to your library.",
        primary: "Open Håfa", secondary: "Later", opens: .primary)
    case .signedOut:
      return HafaShareOutcome(symbol: "person.crop.circle", title: "Sign in to finish",
        detail: "We kept this on your iPhone. Open Håfa and sign in to import it.",
        primary: "Open Håfa", secondary: "Later", opens: .primary)
    case .waiting:
      return HafaShareOutcome(symbol: "iphone", title: "Saved on this iPhone",
        detail: "We couldn’t reach Håfa just now. It’ll import when you open the app.",
        primary: "Open Håfa", secondary: "Done", opens: .primary)
    }
  }

  static let unreadable = HafaShareOutcome(symbol: "exclamationmark", isProblem: true, title: "Couldn’t read this",
    detail: "Try sharing the post’s link instead.", primary: "Close")
}
