# ADR-002: No Dedicated Staging Environment

Status: accepted
Decision date: 2026-08-18
Decision owner: product owner

## Context

The audit found that local Expo development can silently fall back to the production API. The original remediation proposed local, staging/preview, and production environments. At the product's current team size and operating cadence, a continuously deployed staging application would create maintenance work without enough additional value.

The underlying risk is accidental production access, not the absence of a server named “staging.”

## Decision

Håfa Recipes will support two explicit operating modes:

- local/development;
- production.

There will be no required long-lived staging application or staging release process.

Local development will use local services or a disposable non-production database. Paid provider calls should use budget-limited development credentials where practical. A preview build may be created when useful, but it must explicitly declare its backend target and may not inherit or guess one.

## Required controls

- Development fails when its API URL is absent or invalid; it never substitutes the production URL.
- Production configuration is selected explicitly by the production build profile.
- Routine local/intern setup does not require production database credentials.
- A visible development indicator makes non-production builds obvious.
- Tests or CI validate supported environment mappings.
- Any exceptional use of production from a development build is deliberate, short-lived, and documented.

## Consequences

Positive:

- less infrastructure and configuration to maintain;
- the actual safety boundary remains explicit;
- contributors can work with disposable data.

Negative:

- some deployment-only issues will first be exercised in production;
- database migrations and provider changes need stronger local verification, rollout, rollback, and production observation;
- preview testing requires an explicit backend decision each time.

## Revisit triggers

Reconsider a dedicated staging environment if the team grows, releases become frequent or coordinated, enterprise/customer acceptance testing appears, risky migrations become common, or production incidents show that local and automated checks are insufficient.
