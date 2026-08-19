# Håfa Recipes Documentation

This directory is the canonical cross-system documentation for the active Håfa Recipes product.

Last reviewed: 2026-08-19

## Start here

1. [Product and system overview](./PRODUCT-AND-SYSTEM.md)
   - What Håfa Recipes is
   - Why it exists
   - Who it serves
   - Current architecture and product principles

2. [Full system audit](./SYSTEM-AUDIT-2026-08-18.md)
   - Verified findings and evidence
   - Severity and confidence
   - Security, privacy, AI, reliability, data, UX, accessibility, testing, and operations
   - Items that were checked and found to be sound

3. [Improvement roadmap](./IMPROVEMENT-ROADMAP.md)
   - Ordered implementation releases
   - Task IDs, rationale, dependencies, and acceptance criteria
   - Explicit non-goals and deferred work

4. [Decision: defer private chat-image delivery](./decisions/ADR-001-DEFER-PRIVATE-CHAT-IMAGES.md)
   - Scope of the accepted risk
   - Interim controls
   - Revisit date and triggers

5. [Decision: no dedicated staging environment](./decisions/ADR-002-NO-DEDICATED-STAGING.md)
   - Local/development and production boundaries
   - Required protection against accidental production access

6. [Decision: focused admin and moderation surface](./decisions/ADR-003-FOCUSED-ADMIN-SURFACE.md)
   - Admin MVP scope
   - Authorization, reversibility, and audit requirements

7. [Decision: GPT-5.6 Luna baseline with Terra escalation](./decisions/ADR-004-GPT-5-6-MODEL-ROUTING.md)
8. [AI model governance and rollout runbook](./AI-MODEL-GOVERNANCE-RUNBOOK.md)
   - Why one model should not handle every AI task
   - Evaluation and rollout criteria

9. [Database invariants and canonical sources runbook](./DATABASE-INVARIANTS-RUNBOOK.md)
   - Canonical URL rules, concurrency constraints, schema verification, deployment, and rollback

10. [Deletion cleanup operations runbook](./DELETION-CLEANUP-RUNBOOK.md)
   - Durable account and recipe cleanup behavior
   - Queue states, alerts, verification, and safe recovery

11. [Development isolation and dependency runbook](./DEVELOPMENT-AND-DEPENDENCY-RUNBOOK.md)
   - Local PostgreSQL and synthetic seed setup
   - Preview/production target rules and visible environment labels
   - Dependency audit triage and accepted upstream findings

## Source-of-truth policy

- The documents above describe the current product and active plan.
- `ARCHITECTURE_AND_MIGRATION_PROGRAM.md` is authoritative for the monorepo and Clerk identity migration.
- `mobile/ROADMAP.md` is a historical idea list; it contains shipped and stale items and is not the execution tracker.
- Git history and release tags remain the release record until a canonical mobile changelog is added.
- Detailed deployment and migration runbooks remain authoritative for the narrow procedures they describe.
- Model IDs in code or old documentation are not a model strategy. The active model policy is in the audit and roadmap.

## Updating these documents

When work is completed:

1. Update the matching task in `IMPROVEMENT-ROADMAP.md`.
2. Add or update automated tests and operational verification.
3. Update the appropriate release notes for user-visible changes.
4. If a risk is accepted or a major technical choice changes, add or supersede an ADR in `docs/decisions/`.
5. Re-run the relevant audit checks rather than marking findings complete from code inspection alone.

## Terminology

- **Public recipe**: visible in Discover and accessible without owning the recipe.
- **Private recipe**: accessible only to its owner and explicitly authorized collaborators.
- **Extraction**: converting a video, website, or image into structured recipe data.
- **Derived data**: nutrition, cost, tags, meal types, or cached totals calculated from canonical recipe content.
- **Release gate**: a condition that must pass before the related release is shipped.
