# Grocery widget architecture

The iOS grocery widget is a native WidgetKit extension generated through Expo
Continuous Native Generation. Do not hand-edit or commit `mobile/ios`; the
`withHafaGroceryWidget` config plugin recreates the target during prebuild and
EAS builds.

## Product behavior

- The widget follows the app's Calm look: a white sheet (dark: #1A1D1C), the
  deep-reef accent, 1pt hairlines and Figtree, which the config plugin copies
  from `@expo-google-fonts/figtree` into the extension at prebuild.
- Small: items left, plus a preview of the next few. Tapping opens the list.
- Medium/large: what is left to buy comes first, in the app's recipe order,
  under recipe headers like the app's sections. Tapping anywhere on a row
  checks it off (iOS 17 App Intent); the next item moves up into view.
  Checked items only fill leftover space, newest first, so a mistaken tap can
  be undone. When the list is longer than the widget, large ends with "N more on
  your list", which opens the app. There is no paging: the layout in
  `HafaWidgetListLayout.swift` sizes the list to the space.
- Folding: tapping a recipe header folds or unfolds its items
  (`ToggleGrocerySectionIntent`). A folded group shows its name, a chevron and
  how many items are left, and frees its rows for the next group. A list of
  only hand-added items has no headers and cannot fold, in the app or here.
- Add: opens `hafarecipes://grocery?focusAdd=1` and focuses the app's text input.
  WidgetKit does not provide free-form text entry inside a home-screen widget.
  Editing and deleting stay in the app.
- Status: the subtitle reads like the app's ("Shared · 5 items left"). It adds
  "Syncing" while a check is queued, "Showing saved list" after a failed
  refresh, and asks the user to open the app when the widget must reconnect.
- Freshness: app fetches and mutations publish confirmed snapshots immediately;
  WidgetKit also requests a server snapshot on its budgeted timeline.

Layout tests: `widget/tests/test-widget-layout.sh` compiles the layout with the
shared models and runs its fixtures on the Mac.

## Data and authentication boundary

The extension never receives a Clerk token. The signed-in app provisions a
90-day, revocable, installation-scoped bearer that can only read the bound
grocery list and set an item's desired checked state. The bearer is stored in a
dedicated shared Keychain access group; the grocery snapshot and mutation queue
live in the existing app-group container.

Folded groups are display state, not list data. They never reach the server.
The app and the widget share one copy in the app-group state file
(`collapsed_section_keys` plus `collapsed_sections_updated_at`), scoped to the
snapshot's list and cleared with it on an account or list change. The widget
writes it when a header is tapped. The app also saves its own copy per list,
publishes each change, and compares copies when it returns to the foreground;
the newer change wins. Keys without a time were left by the retired paging
widget and are ignored.

Widget check-off is durable and replay-safe:

1. Persist an idempotent mutation ID and desired checked state under a
   cross-process file lock.
2. Apply the state optimistically to the local widget snapshot.
3. Send the queued operation to the least-privilege widget API.
4. Remove it only after a matching server response is stored atomically.

Network and 5xx failures keep the operation queued. Authentication or list-scope
changes require the app to reconnect. Sign-out and identity changes scrub the
local bearer and snapshot before waiting on best-effort server revocation.

## Reproducing the native project

From `mobile/`:

```sh
npx expo prebuild --platform ios --clean --no-install
npx pod-install
```

Verify the generated workspace with an iOS simulator build. The widget itself
requires an iOS 17 or newer simulator/device and a development build; it is not
available in Expo Go.
