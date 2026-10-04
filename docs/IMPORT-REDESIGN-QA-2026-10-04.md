# Import screen redesign — October 4, 2026

The previous screen mixed capture, settings, help, history, and alternative inputs. Region chips collided with notes, history dominated the page, and a persistent action bar and chat bubble obscured content. This change gives link capture one compact composer and moves optional decisions into focused sheets.

## Design research

- [Crouton](https://crouton.app/) emphasizes recipe capture from copied links and photos. Its public product screenshots informed the calmer grouping; its import modal was not directly inspected.
- [AnyList recipe import](https://help.anylist.com/articles/feature-overview-recipe-import/) documents direct capture through the share menu.
- [Paprika’s iOS guide](https://www.paprikaapp.com/help/ios/) separates browser capture from optional recipe details.
- [Apple’s sheet guidance](https://developer.apple.com/design/human-interface-guidelines/sheets) supports focused secondary tasks without losing the main context.

The resulting hierarchy is our design inference: link, visible privacy/location summary, and Import Recipe belong together. Settings and help have separate sheets. Alternative inputs use three compact rows. Unfinished imports remain actionable, while saved history starts collapsed. Ask Håfa is an inline action on this tab.

## Native checks

Computer-use QA ran against the final JavaScript on owned iPhone 17 Pro (iOS 26.5) and 375-point iPhone SE (iOS 18.5) simulators, using an isolated local API/database and a disposable development identity.

- Checked light/dark appearance, the small screen, and the largest accessibility text size. Labels wrap without overlapping controls.
- Verified the import action is visible without scrolling on the small screen and remains fully visible with the software keyboard open. Keyboard QA identified a clipped action; focusing the composer now scrolls it above the keyboard.
- Opened settings, changed privacy and region, entered notes, and reopened the sheet. Values persisted. Region choices use an expanding vertical list; notes have their own space. Native keyboard insets keep the notes caret visible.
- Submitted a private import with notes through the actual UI/API and verified those values on the owner-scoped job.
- Queued a second link, kept a third unsubmitted draft, and supplied two synthetic local worker completions. The second intake started automatically; both completions preserved the third draft and did not force navigation.
- Restored an older failed job placed after four saved jobs. Recovery controls remained available with history collapsed, and restoring it preserved the new draft. Expanded/collapsed saved history, opened/closed Import help, and opened/closed Ask Håfa without sending a message.

The native shell was the existing development build; these changes add no native dependency. Physical-device and store-build testing remain release checks. Paid extraction providers were disabled locally, so completion transitions used synthetic fixtures rather than a new live AI extraction. Recent activity still uses the existing eight-job API window; this is not unlimited history.

## Verification

Focused tests cover settings persistence, clipboard races across edits/account changes/unmount, history recovery, and the tab bar. Independent read-only reviews found no material blockers after contrast and duplicate-status fixes. The final repository gate includes the isolated PostgreSQL suites, mobile/admin tests, type checks, lint, builds, dependency audits, and Expo Doctor; release evidence records its final result and PR review coverage.
