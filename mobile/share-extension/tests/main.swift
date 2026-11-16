import Foundation

// Run on a Mac: swiftc share-extension/HafaShareContent.swift share-extension/RecipeShareWords.swift
//   share-extension/tests/main.swift -o /tmp/recipe-share-card-tests && /tmp/recipe-share-card-tests
var checks = 0
func check(_ condition: Bool, _ label: String) {
  guard condition else { fatalError("Failed: \(label)") }
  checks += 1
}
let describe = { (link: String?, title: String?) in
  HafaSharePreviewText.describe(url: link.flatMap(URL.init(string:)), pageTitle: title, fallback: RecipeShareWords.fallbackTitle)
}

// The card names the site, the creator when the link or page says who, and the dish.
let reel = describe("https://www.instagram.com/reel/C1abc/?igsh=xyz", "Mama Lou on Instagram: \"Chicken kelaguen 🍋\nRecipe below\"")
check(reel == .init(title: "Chicken kelaguen 🍋", subtitle: "Mama Lou · Instagram"), "Instagram caption and creator")
let tiktok = describe("https://www.tiktok.com/@islandcook/video/123", "Red rice in one pot | TikTok")
check(tiktok == .init(title: "Red rice in one pot", subtitle: "@islandcook · TikTok"), "TikTok handle from the link")
let bare = describe("https://vm.tiktok.com/ZMabc/", nil)
check(bare == .init(title: "Recipe from TikTok", subtitle: "TikTok"), "a short link with nothing else")
let generic = describe("https://www.instagram.com/p/xyz/", "Instagram")
check(generic.title == "Recipe from Instagram", "a site-wide title says nothing")
let blog = describe("https://www.seriouseats.com/best-pancakes", "The Best Pancakes")
check(blog == .init(title: "The Best Pancakes", subtitle: "seriouseats.com"), "an ordinary site keeps its host")
let youtube = describe("https://youtu.be/abc", "Garlic noodles - YouTube")
check(youtube == .init(title: "Garlic noodles", subtitle: "YouTube"), "YouTube suffix")
check(describe(nil, nil) == .init(title: "Shared recipe", subtitle: nil), "no link at all")
let long = describe("https://example.com/x", String(repeating: "a", count: 140))
check(long.title.count == 90 && long.title.hasSuffix("…"), "long captions are cut")
check(HafaSharePreviewText.site(URL(string: "https://m.youtube.com/watch?v=1")!) == "YouTube", "subdomains map to the site")
check(HafaSharePreviewText.handle(URL(string: "https://example.com/@")!) == nil, "a bare @ is no handle")

// Private is a real default and Public always says what happens next.
check(RecipeShareWords.visibilityChoice(isPublic: false).selected == "private", "private selected")
check(RecipeShareWords.visibilityChoice(isPublic: true).selected == "public", "public selected")
check(RecipeShareWords.note(isPublic: true, kind: .link).contains("confirm"), "public link says it will ask")
check(RecipeShareWords.note(isPublic: true, kind: .photos(2)).contains("photos stay private"), "photo pages stay private")

// Only a private link from a signed-in phone is sent from the extension.
check(RecipeShareWords.sendsNow(kind: .link, isPublic: false, signedIn: true), "private link sends")
check(!RecipeShareWords.sendsNow(kind: .link, isPublic: true, signedIn: true), "public never sends")
check(!RecipeShareWords.sendsNow(kind: .link, isPublic: false, signedIn: false), "signed out never sends")
check(!RecipeShareWords.sendsNow(kind: .photos(1), isPublic: false, signedIn: true), "photos wait for review")
check(!RecipeShareWords.sendsNow(kind: .text, isPublic: false, signedIn: true), "text waits for review")

let result = RecipeShareWords.result
check(result(.link, false, true, true) == .importing, "accepted private link")
check(result(.link, false, true, false) == .waiting, "refused or offline")
check(result(.link, true, true, false) == .confirmPublic, "public link")
check(result(.photos(3), true, true, false) == .review, "photos")
check(result(.text, false, false, false) == .signedOut, "signed out wins")

// Only the finished import closes itself; every other outcome has a next step and an Open Håfa button.
for value in [RecipeShareWords.Result.importing, .confirmPublic, .review, .signedOut, .waiting] {
  let outcome = RecipeShareWords.outcome(value)
  check(outcome.closesItself == (value == .importing), "\(value) closes only when done")
  let opener = outcome.opens == .primary ? outcome.primary : outcome.secondary
  check(opener == "Open Håfa", "\(value) offers Open Håfa")
  check(!outcome.isProblem, "\(value) is not a problem")
}
check(RecipeShareWords.unreadable.isProblem && RecipeShareWords.unreadable.opens == nil, "unreadable is a dead end with Close")
print("Recipe share card: \(checks) checks passed")
