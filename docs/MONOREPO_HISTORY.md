# Monorepo history and rollback record

Migration date: 2026-08-17

## Source repositories

| Component | Standalone repository | Original `main` tip | Standalone rollback tag | Filtered monorepo tip | Monorepo tag |
|---|---|---|---|---|---|
| API | `Shimizu-Technology/recipe-api` | `428be676f55e0cad55d0a5e704c846d81804b9a8` | `monorepo-migration-2026-08-17` | `33d9726` | `api-pre-monorepo-2026-08-17` |
| Mobile | `Shimizu-Technology/recipe-mobile` | `fd1b0afcce94965528a6fe42909d035c91127c0d` | `monorepo-migration-2026-08-17` | `58150b4` | `mobile-pre-monorepo-2026-08-17` |
| Website | `Shimizu-Technology/Hafa-Recipes-Website` | `df2ff06b500a5928fe9df98e5a8d3cf212bff988` | `monorepo-migration-2026-08-17` | `8015b52` | `web-pre-monorepo-2026-08-17` |

The filtered commit IDs differ because every historical path was prefixed with
`api/`, `mobile/`, or `web/`. The complete parent graphs remain reachable through
the merge commits and tags.

## Intentionally excluded

- the retired Next.js prototype and its separate personal repository;
- archived source snapshots;
- local `.env` files, cookies, credentials, provider exports, and database data;
- generated Expo/Android/iOS artifacts, AABs, IPAs, archives, and screenshots;
- the superseded Clerk cutover branches from API PR 3 and mobile PR 5.

The standalone repositories remain available until all production providers are
verified against the monorepo. They should then be archived, not deleted.
