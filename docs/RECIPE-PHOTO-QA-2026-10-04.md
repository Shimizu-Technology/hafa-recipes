# Recipe photo restoration — October 4, 2026

The compact source thumbnail made the food hard to recognize. Restore a large photo at the top of recipe details while retaining the cleaner nutrition, equipment, tabs, and cooking action from the previous release.

The photo now leads a rounded, inset card. Social source controls sit beneath it, with wrapping text and no overlay covering the food. Social photos use 4:3; YouTube uses 16:9. The hero is centered with an 800-point outer maximum width and a 340-point image-height cap. The photo/card width is also capped at the corresponding aspect ratio multiplied by 340 points, with the card's border included, to keep wide frames proportional. Website and manual photos use the same inset and rounded corners. A missing or failed photo leaves no empty image area; social recipes retain their source action. This follows React Native's documented [aspect-ratio and dimension constraints](https://reactnative.dev/docs/0.86/layout-props#aspectratio).

Image failure state belongs to the current source and normalized image URL. A replacement image recovers, and a late failure from the previous image cannot hide it. Changing recipes also remounts the hero. Embedded players still require an explicit press, retain the privacy notice, and close before opening an external source. Production retains its existing external playback policy.

## Verification

- `./scripts/check.sh` passed: 801 API tests, 10 existing skips; 723 mobile tests; 13 admin tests. TypeScript, Expo Doctor (21/21), web/admin lint and builds, and dependency audits passed.
- Focused hero/source/thumbnail tests passed (18 tests), including replacement after failure, late old callbacks, missing/whitespace photos, one photo per card, external playback policy, and explicit player activation/teardown.
- Computer-use QA on an iPhone SE simulator (375-point width, iOS 18.5) confirmed the large Instagram photo in light and dark themes, a website photo, failed-photo collapse with the source action preserved, and a manual recipe without a blank hero.
- At the largest accessibility text setting, the Instagram source copy wrapped and the photo remained correctly sized. Pressing the source action opened Instagram in Safari. The fixed cooking action remained available; nutrition navigation worked after scrolling.
- Native QA used an existing development shell and a loopback API with synthetic recipe content. The food image and original source link were public media; no production recipes were edited. The development-only environment banner clips at maximum text size; production does not render that banner.
- After the width-cap review fix, the full repository gate passed again with the same counts. Read-only implementation review found no material issues in the follow-up diff.
- Native iPad Pro 13-inch (iOS 26.5) QA confirmed a centered 4:3 Instagram card in portrait, a proportional 16:9 YouTube card in landscape, and a centered website photo. The YouTube source row and privacy footer remained readable at the largest accessibility text setting after navigating to a fresh recipe screen. An earlier iOS 18.5 tablet shell failed to launch; the newer simulator completed these checks. No physical-device QA was performed in this session.

This is a mobile presentation change. It requires a new mobile build; it adds no API changes, migrations, or production backfills.
