import Foundation
import ImageIO

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
check(RecipeShareWords.note(isPublic: true, kind: .link).contains("Discover"), "public link says where it goes")
check(RecipeShareWords.note(isPublic: true, kind: .photos(2)).contains("photos stay private"), "photo pages stay private")

// A link from a signed-in phone is sent from the extension, public or private.
check(RecipeShareWords.sendsNow(kind: .link, isPublic: false, signedIn: true), "private link sends")
check(RecipeShareWords.sendsNow(kind: .link, isPublic: true, signedIn: true), "public link sends")
check(!RecipeShareWords.sendsNow(kind: .link, isPublic: false, signedIn: false), "signed out never sends")
check(!RecipeShareWords.sendsNow(kind: .photos(1), isPublic: false, signedIn: true), "photos wait for review")
check(!RecipeShareWords.sendsNow(kind: .text, isPublic: false, signedIn: true), "text waits for review")

let result = RecipeShareWords.result
check(result(.link, false, true, true, false) == .importing, "accepted private link")
check(result(.link, false, true, false, false) == .waiting, "refused or offline")
check(result(.link, true, true, true, false) == .importingPublic, "accepted public link")
check(result(.link, true, true, false, true) == .confirmPublic, "public link Håfa has to finish")
check(result(.link, true, true, false, false) == .waiting, "public link while offline")
check(result(.photos(3), true, true, false, true) == .review, "photos")
check(result(.text, false, false, false, false) == .signedOut, "signed out wins")

// Only the finished import closes itself; every other outcome has a next step and an Open Håfa button.
for value in [RecipeShareWords.Result.importing, .importingPublic, .confirmPublic, .review, .signedOut, .waiting] {
  let outcome = RecipeShareWords.outcome(value)
  check(outcome.closesItself == (value == .importing || value == .importingPublic), "\(value) closes only when done")
  let opener = outcome.opens == .primary ? outcome.primary : outcome.secondary
  check(opener == "Open Håfa", "\(value) offers Open Håfa")
  check(!outcome.isProblem, "\(value) is not a problem")
}
check(RecipeShareWords.unreadable.isProblem && RecipeShareWords.unreadable.opens == nil, "unreadable is a dead end with Close")
print("Recipe share card: \(checks) checks passed")

// A large encoded photo and a malformed file exercise the production downsampler.
let photo = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".jpg")
defer { try? FileManager.default.removeItem(at: photo) }
do {
  let context = CGContext(data: nil, width: 4096, height: 2048, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
  let destination = CGImageDestinationCreateWithURL(photo as CFURL, "public.jpeg" as CFString, 1, nil)!
  CGImageDestinationAddImage(destination, context.makeImage()!, [kCGImagePropertyOrientation: 6] as CFDictionary)
  check(CGImageDestinationFinalize(destination), "photo fixture encoded")
}
let thumb = HafaShareThumbnail.image(at: photo)!
check(thumb.width == 90 && thumb.height == 180, "large photo downsampled with orientation")
try Data("not an image".utf8).write(to: photo)
check(HafaShareThumbnail.image(at: photo) == nil, "malformed photo has no preview")
check(HafaShareThumbnail.image(at: URL(string: "https://example.com/image.jpg")!) == nil, "thumbnail cannot fetch a URL")
print("Photo downsampling: large file, orientation, malformed and remote checks passed")

let key = String(repeating: "a", count: 43)
let blockedPreviews = [
  "https://user:pass@example.com/recipe", "https://user@example.com/recipe", "https://example.com/?TOKEN=secret",
  "https://example.com/?key=s", "https://example.com/?sig=s", "https://example.com/?auth=s",
  "https://example.com/?access_token=s", "https://example.com/?code=s", "https://example.com/?%74oken=s",
  "https://example.com/?X-Amz-Signature=s", "https://example.com/?bearer=s", "https://example.com/#access_token=secret",
  "https://hafarecipes.com/r/\(key)", "https://custom.example/r/\(key)",
  "http://localhost/a", "http://localhost./a", "http://foo.local/a", "http://foo.local./a", "http://intranet/a",
  "http://127.0.0.1/a", "http://127.1/a", "http://2130706433/a", "http://0x7f000001/a", "http://0177.0.0.1/a",
  "http://10.0.0.1/a", "http://172.16.0.1/a", "http://172.31.255.255/a", "http://192.168.1.1/a",
  "http://169.254.169.254/a", "http://0.0.0.0/a", "http://[::1]/a", "http://[::]/a",
  "http://[fc00::1]/a", "http://[fe80::1]/a", "http://[::ffff:127.0.0.1]/a", "file:///tmp/recipe",
]
for value in blockedPreviews { check(!HafaSharePreviewPolicy.allows(URL(string: value)!), "blocked preview: \(value)") }
for value in ["https://www.instagram.com/reel/abc/?igsh=xyz", "https://www.tiktok.com/@cook/video/123", "https://example.com/recipe?servings=4", "https://8.8.8.8/recipe", "https://[2606:4700:4700::1111]/recipe"] {
  check(HafaSharePreviewPolicy.allows(URL(string: value)!), "public preview: \(value)")
}
print("Preview privacy: sensitive URLs, local hosts and public controls passed")

for name in ["rlkey", "resourcekey", "sid", "sk", "otp", "Policy", "Signature", "Expires", "token", "access_token", "code"] {
  for separator in ["?", "#"] {
    check(!HafaSharePreviewPolicy.allows(URL(string: "https://example.com/recipe\(separator)\(name)=secret")!), "secret parameter in query/fragment: \(name)")
  }
}
for link in ["https://example.com/#%74oken=secret", "https://example.com/#/auth?access_token=secret", "https://example.com/#route?code=secret",
  "https://www.dropbox.com/s/private-key/recipe.jpg", "https://dropbox.com/scl/fi/private-key/recipe.jpg",
  "https://drive.google.com/file/d/private-key/view", "https://docs.google.com/document/d/private-key/edit"] {
  check(!HafaSharePreviewPolicy.allows(URL(string: link)!), "path/fragment credential: \(link)")
}
for link in ["https://example.com/recipe#comments", "https://example.com/recipe#recipe", "https://example.com/recipe#step=2", "https://example.com/recipe#token", "https://dropbox.com/features", "https://drive.google.com/about", "https://notdropbox.com/s/public"] {
  check(HafaSharePreviewPolicy.allows(URL(string: link)!), "ordinary anchor/public page: \(link)")
}
print("Round 2 preview policy checks passed")

for value in ["http://home.arpa/recipe", "https://router.home.arpa/recipe", "https://deep.router.home.arpa./recipe", "https://HOME.ARPA./recipe"] {
  check(!HafaSharePreviewPolicy.allows(URL(string: value)!), "home.arpa private preview: \(value)")
}
for value in ["https://nothome.arpa/recipe", "https://home.arpa.example.com/recipe"] {
  check(HafaSharePreviewPolicy.allows(URL(string: value)!), "home.arpa boundary control: \(value)")
}
print("home.arpa exact/suffix/trailing-dot regression cases passed")
