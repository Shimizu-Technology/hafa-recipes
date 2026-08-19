# ADR-003: Focused Admin and Moderation Surface

Status: accepted
Decision date: 2026-08-18
Decision owner: product owner

## Context

Håfa Recipes already has public user-generated recipes, contributor identity, extraction jobs, and a limited admin privilege for re-extraction. It lacks a coherent way to review reports, curate public content, recover stuck work, or understand who performed an administrative change. The unsafe alternative is direct database manipulation.

## Decision

Build a small separate web application, provisionally `admin/`, backed by explicit FastAPI `/api/admin/*` actions.

Use Clerk for authentication and the existing admin metadata as the first role mechanism. Every endpoint must enforce authorization on the server. The interface is not a general database browser and is not embedded in the consumer mobile app.

## MVP scope

- Report queue for recipes and contributors.
- Recipe and contributor lookup.
- Reversible hide/unhide and feature/unfeature actions.
- Curated ordering for featured recipes or collections.
- Stuck/failed extraction visibility with safe retry/cancel actions.
- Recent admin activity.
- Append-only audit events containing actor, action, target, reason, timestamp, and bounded before/after context.

## Explicit MVP exclusions

- arbitrary SQL or record editing;
- silent ownership reassignment;
- user impersonation;
- hard deletion as the normal moderation action;
- bulk actions without preview and confirmation;
- exposing private recipe/chat content merely because an operator is an admin.

## Security and product rules

- Prefer hide, unpublish, restore, retry, and cancel over irreversible actions.
- Require an operator reason for moderation changes.
- Keep private user data out of default moderation views.
- Log allowed and denied privileged actions without logging private recipe content.
- Add moderator/support roles only when real responsibilities require them; one admin role is sufficient initially.

## Why a separate web surface

Moderation and operational work benefits from desktop density, search, queues, and side-by-side context. Keeping it separate avoids shipping privileged UI in the consumer app and avoids reviving the deprecated Next.js product.

## Interface direction

Use a calm, utilitarian operational layout rather than a generic card dashboard: persistent queue/search navigation, dense but readable tables, a contextual detail panel, explicit status and reason fields, and clear confirmation for risky actions. Retain Håfa's warm palette lightly, while prioritizing semantic HTML, keyboard navigation, visible focus, contrast, and reduced motion. Status must never be communicated by color alone.

## Implementation tracking

The product owner accepted the MVP scope and separate-web direction on 2026-08-18. The server-side foundation was implemented on 2026-08-19: migration 022, shared public-visibility policy, reporting/blocking/appeal contracts, reversible moderation and curation actions, safe extraction recovery, and append-only audit history. The separate `admin/` interface and consumer report/block controls remain tracked in roadmap task C7. Operational details are in `ADMIN-MODERATION-RUNBOOK.md`.
