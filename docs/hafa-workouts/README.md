# Håfa Workouts product and platform plan

Planning date: October 10, 2026. Status: compatible backend foundation implemented; full Workouts implementation is ongoing. TestFlight delivery remains pending. See [implementation status](IMPLEMENTATION_STATUS.md) for verified coverage.

Håfa Workouts turns saved workout sources into personal training plans, guided sessions, and durable training history. The complete release includes general fitness, strength, body composition, running programs, general athletic conditioning for goals such as basketball, and optional Apple Health/Android Health Connect integrations. The product belongs to the same visibly connected Håfa family as Recipes.

Leon has asked for the complete product, delivered through engineering milestones. Finishing an importer and chatbot does not complete this plan.

## Confirmed decisions

| Decision | Requirement |
| --- | --- |
| Platforms | iPhone, Android, and marketing/support website. |
| Account | One Håfa account, separate product data, explicit opt-in connections. |
| Deletion | Leon approved whole-Håfa account deletion across both apps, with separate controls for removing only one product's data. Shared-account enrollment explains that older Recipes account deletion also affects Workouts. |
| Brand relationship | People can recognize and navigate between the two Håfa products. |
| Content | Private libraries and intentional sharing; public workout Discover is not part of the agreed release. |
| Coaching | Adults; general fitness and self-reported limitations, without medical diagnosis or prescribed rehabilitation. |
| Goals | General training with flexible goals/activities: fitness, strength/muscle, body composition, running, and athletic conditioning. Leon expects running, working out, and possibly basketball; separate sport-specific products/catalogs are not required. |
| Health integrations | Apple Health and Android Health Connect belong in the complete release. |
| Access and payment | Match Recipes: publicly available and free during beta, with paid options considered later. This interprets “like HafaRecipes” as access/payment, not approval of public workout Discover. |
| Production | Installed Recipes clients continue working while backend and mobile releases happen independently. |

## Documents

- [Product requirements](PRD.md): full scope, connected objects, programming behavior, privacy, and acceptance.
- [Experience specification](EXPERIENCE.md): navigation, screen states, app relationships, and defining journeys.
- [Platform architecture](ARCHITECTURE.md): boundaries, identity, data, jobs, health integrations, and compatible deployment.
- [Build plan](BUILD_PLAN.md): dependency-ordered milestones with exit conditions.
- [Execution and production protection plan](EXECUTION_PLAN.md): ordered engineering slices, exact rollout sequence, and readiness/delivery gates.
- [QA plan](QA_PLAN.md): required scenarios, fixtures, device coverage, and execution ledger contract.
- [QA ledger](qa-ledger.json): per-case execution records, initially all `not_run`.

## Decisions still to close

| ID | Decision | Proposed position / gate |
| --- | --- | --- |
| D01 | Training scope — resolved | Leon clarified a general app for running, workouts, and possibly basketball. Use flexible goals and general athletic conditioning, with running programming and basketball-related examples. Do not impose a volleyball or exhaustive sport-specific catalog. |
| D02 | Shared-account deletion — policy resolved | Leon approved whole-account deletion plus per-product data controls and disclosure of older Recipes deletion behavior. Technical cleanup, late-write prevention, and actual-client acceptance remain gates before shared-account enrollment goes live. |
| D03 | Domain-reviewed programming rules and content | Establish sourced templates, exercise substitutions, progression and interruption rules; record review and unresolved limits before releasing automated programming. |
| D04 | Hosting topology | Decide from isolated mixed-workload tests and current billing/capacity, not from the small database alone. |
| D05 | Distribution/device coverage | Verify minimum supported OS versions, native dependencies, exact store builds, provider declarations, and physical test devices. New Workouts requirements do not force a Recipes upgrade. |

Questions of exact price, artwork, numerical usage allowances, and workout notification wording do not block the architecture. They must be resolved before the affected user experience is released.

## Evidence baseline

The planning worktree starts from HafaRecipes GitHub main `37e64e2886506cc40d65d45657c630b43c0f97d4`, also verified as the live Render commit during the October 10 review. The original checkout is behind main and contains unrelated documentation changes; it was preserved.

The October 10 read-only review found a single Starter Render service, sampled memory reaching approximately 397 MiB during the preceding day, and a roughly 20.3 MiB PostgreSQL database snapshot. These are orientation evidence, not approval of combined workload capacity or verified Neon billing headroom. Recheck before implementation/deployment decisions.

The Recipes source at this commit presents public App Store access and all features free during beta: [website source](https://github.com/Shimizu-Technology/hafa-recipes/blob/37e64e2886506cc40d65d45657c630b43c0f97d4/web/src/pages/Home.tsx). [Existing release runbook](../APP-STORE-RELEASE-RUNBOOK.md) and [identity migration program](../ARCHITECTURE_AND_MIGRATION_PROGRAM.md) remain governing sources.

Apple's public US lookup on October 10 reported Recipes version **2.6.4**, minimum iOS **17.0**, released September 20 UTC. Current source declares **2.6.11 / iOS build 88**; that declaration does not establish App Store availability. Older installed versions also require an explicit inventory. [Public lookup](https://itunes.apple.com/lookup?id=6755892896&country=us).

Source research and implementation evidence are linked next to relevant requirements. No live user content, credentials, or medical details are included in this plan.

The API/GitHub commit and US App Store 2.6.4 baseline were rechecked after Leon accepted D02; no deployment or listing change was made by this planning task.
