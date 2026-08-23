# Grocery widget architecture

The iOS grocery widget is a native WidgetKit extension generated through Expo
Continuous Native Generation. Do not hand-edit or commit `mobile/ios`; the
`withHafaGroceryWidget` config plugin recreates the target during prebuild and
EAS builds.

## Product behavior

- Small: unchecked-item count and a link into the grocery list.
- Medium/large: four/eight items at a time with iOS 17 interactive check-off
  and native previous/next controls for browsing the entire saved list.
- Add: opens `hafarecipes://grocery?focusAdd=1` and focuses the app's text input.
  WidgetKit does not provide free-form text entry inside a home-screen widget.
- Edit: tapping an item name opens that item's existing edit sheet in the app.
  Destructive delete remains in the app, where iOS can present confirmation.
- Freshness: app fetches and mutations publish confirmed snapshots immediately;
  WidgetKit also requests a server snapshot on its budgeted timeline.

## Data and authentication boundary

The extension never receives a Clerk token. The signed-in app provisions a
90-day, revocable, installation-scoped bearer that can only read the bound
grocery list and set an item's desired checked state. The bearer is stored in a
dedicated shared Keychain access group; the grocery snapshot and mutation queue
live in the existing app-group container.

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
