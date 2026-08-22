# Grocery widget credential contract

The iOS widget does not receive or reuse a Clerk session token. WidgetKit runs
outside the React Native process, while Clerk tokens are short-lived and owned
by the signed-in app. Instead, the app provisions one narrowly scoped widget
credential after Clerk authentication.

## Lifecycle

1. The app generates and retains a random installation UUID.
2. With a current Clerk bearer token, it sends that UUID to
   `POST /api/grocery/widget/credentials`.
3. The API locks the stable application user, resolves the current grocery
   membership, and issues a 256-bit opaque bearer token. The token is returned
   once with `Cache-Control: no-store`; only its namespaced SHA-256 digest is
   stored.
4. Reissuing for the same installation rotates the secret and invalidates the
   previous token. A user can have at most five active installations.
5. The native app and extension use the token only with the widget snapshot,
   desired-state check-off, and self-revocation endpoints.
6. The app rotates the credential whenever the bound list changes and revokes
   it before sign-out. Account deletion removes every credential through the
   stable-user foreign key.

Credentials expire after 90 days. Opening the signed-in app renews the current
installation. The widget treats `401` as signed out or expired, and treats
`409` as a changed list scope that requires reopening the app.

## Granted endpoints

- `GET /api/grocery/widget/snapshot`
- `POST /api/grocery/widget/set-checked`
- `DELETE /api/grocery/widget/session`

The checked-state request contains `mutation_id`, `list_id`, `item_id`, and the
desired Boolean state. It uses the same hash-bound grocery mutation receipt as
the app, so a lost response can be retried without toggling the item twice.

The widget credential cannot add, edit, or delete items; manage members or
invites; access recipes; or call any general application endpoint. The snapshot
omits stable member IDs. Free-form item entry remains an app deep link because
WidgetKit does not provide an inline text-entry surface.

## Concurrency and revocation

Widget authentication, credential rotation/revocation, grocery membership
transitions, and account deletion all serialize on the same `app_users` row.
After taking that lock, the API revalidates the credential and exact
`(app_user_id, list_id)` membership before reading or mutating. This prevents a
token from crossing a concurrent list move or winning a race after revocation.

The opaque token will be stored by the native implementation in a shared
Keychain access group. Grocery snapshots contain no bearer credential and are
stored separately in the existing app group for WidgetKit rendering.
