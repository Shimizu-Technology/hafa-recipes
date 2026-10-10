# Håfa Workouts experience specification

The consumer experience centers on starting today's appropriate session and keeping its results. Capture, coaching, plans, history and app connections should support that task without requiring repeated navigation or conversation.

## Product experience brief

Adults train at home, in gyms, outdoors and around other activities. During training they may be tired, moving, using one hand or disconnected. Preparation screens can expose detail; the execution screen must prioritize the next action and preserve progress.

Use recognizable Håfa brand/account details with a distinct fitness presentation: legible typography, calm surfaces, clear hierarchy and strong contrast in light/dark modes. Inspect approved Recipes assets before choosing final artwork or colors. No default physique imagery, decorative metrics or motivational claims that imply a clinical result. Marketing should show real product flows and accurately available features.

Use semantic colors for action, progress, caution, errors and neutral state. Controls need accessible names, scalable text, reachable touch targets and screen-reader order. Units are visible beside values. Native numeric/text keyboards must not obscure current inputs. Keyboard, reduced-motion and accessible text testing are release requirements.

Motion budget: saving an import may transition into its persistent activity entry; completing a set may quietly confirm and expose the next set. Both have still alternatives and never delay input or hide data. Rest/session progress uses actual timestamps rather than animation timing.

## Navigation and screens

| Destination | Primary content and actions | Essential states |
| --- | --- | --- |
| Today | Scheduled session, purpose, available time/equipment, start/resume, short alternative, other activity, contextual coach | No plan; rest day; partial session; offline local state; pending sync; changed plan. |
| Library | Saved workouts/programs, collections, search and filters, prominent capture | No items; import processing; failed/incomplete source; long content; missing source; private shared copy. |
| Plan | Current program, week/calendar, session purpose, future progression, schedule adjustments | No plan; proposed plan; active/paused/completed plan; conflict; missed days; event-date change. |
| Progress | Completed/partial sessions, performance trends, running history, goal/measurement history | Insufficient data; source gaps; comparable exercise changes; duplicate activity; corrected history. |
| Coach | Context-aware conversation and reviewable actions, accessible from relevant screens | Provider unavailable; stale context; declined AI consent; ambiguous request; proposal pending; action succeeded/failed. |
| Profile | Goals, equipment locations/load ranges, schedule, units, limitations, what the coach knows | Optional unknowns; expired temporary feedback; changed preferences; removed field. |
| Connections | Health integrations, Recipes grants, allowed uses, freshness, disconnect/export/delete | No connection; partial authorization; no visible samples; unsupported platform; expired token; revoked grant. |
| Håfa apps | Shared-account explanation, other app destination, useful connection entry | Other app absent; store link unavailable; user has not enrolled in other product; same-account sign-in needed. |

Coach entry and active-session resume remain available without creating a crowded fifth permanent tab. Capture has link, text, photo/document and manual choices. Settings is reached from the profile/account control.

## Defining journeys

E01 — Existing Recipes user joins Workouts. Website/store → install → choose existing Håfa account → sign in → recover same stable user → confirm Workouts enrollment/account scope → adult onboarding → Today. Recipes ownership and behavior remain intact. Sign-in is not automatic consent to share recipe or health data.

E02 — Capture from another app. Share source → confirm capture/privacy → save durable request → return to source or open import → receive completion/failure state → open saved workout → inspect/edit uncertainty → save adapted version or schedule. Repeated sharing and reconnect do not create accidental duplicate work. Technical job completion and usable workout completeness are visibly separate.

E03 — Prepare a plan. Profile → prioritized goal → availability/equipment/activity context → proposed multiweek plan → inspect session reasons/conflicts → edit/accept → calendar → exact session. Returning from an exercise/source restores the proposal or calendar week. A plan can be manually created when AI is unavailable.

E04 — Train with interruption. Today → start → inspect current target/previous result → log actual set → rest → inspect instruction/chat → return → background/terminate app or lose connection → resume → finish partial/full session → review saved history → reconcile sync. Completed work is never inferred from elapsed time alone.

E05 — Change the week. Plan → missed session or new basketball/run activity → propose move/reduce/skip → inspect affected future sessions → apply → consistent Today/calendar/history. Preserve already completed work and existing scheduled rest. Do not silently regenerate the whole program.

E06 — Link health data. Connections → explanation of data/use → platform permission → choose any permitted server/AI uses separately → import eligible samples → see source/freshness → revisit tracking → disconnect. Platform read privacy may prevent distinguishing denial from an empty store; wording is “No activity available” with permission-management help, not a false definite diagnosis of permission state.

E07 — Share intentionally. Open workout/program → preview exactly shared content → create grant/link → recipient opens or signs in preserving destination → recipient copies/adapts → sender revokes link. Previously authorized recipient copies remain explicitly explained; revocation blocks further grant-based access rather than claiming to recall exported copies.

E08 — Connect Recipes. Håfa apps/Connections → inspect benefit and categories → grant specific direction/use → open permitted Recipes context → use it for the stated purpose → revoke → subsequent queries/AI memory stop using that grant. Opening the other app does not itself establish data consent.

## Concrete layouts

Today should show one primary session with title, purpose, expected duration, required equipment and Start/Resume. A compact “Adjust today” action exposes time, equipment and readiness changes. Other activities and week's progress are secondary. Rest days explain the plan rather than display a failure state.

Workout details show the source and version identity, overview/equipment, ordered blocks and unresolved facts. “Use original” and “Adapt for me” are distinct actions. Editing retains source uncertainty until addressed. The default saved state is private; intentional sharing is a separate preview.

Training shows the exercise/block, accessible instruction entry, targets and previous results beside actual inputs, one clear log/next action, rest controls and pause/end. Keep partial-session progress visible. Undo targets the actual recent action and records correction without pretending the action never synced.

Plan review shows a readable week with session purposes and important assumptions; deeper exercise detail is available without destroying the proposal. Material replacements display what changes and when. Input fields use the person's units while storage calculations use canonical units.

Progress favors actionable history: planned/completed totals, comparable exercise trends and running outcomes. Do not interpret missing sync coverage as inactivity, inflate best efforts across incompatible movements, or use daily exercise streaks to imply rest is failure.

## Public website and connection language

Explain supported capture, personal plans, session tracking, adult scope, free-beta terms and the relationship to Recipes. Publish privacy, support and deletion destinations. Store buttons appear only for genuinely available builds/platforms. Platform availability and public beta access are distinct from pre-release TestFlight/Play testing.

Use plain shared-account language: “Two apps. One Håfa account.” Explain that training and recipe data stay separate unless connected. Recipes cross-promotion changes can ship separately from Workouts; installed Recipes binaries must not be required to display a new screen before Workouts can operate safely.

For each screen implement loading, empty, stale, error, permission and unavailable states. Persist drafts and originating context through sign-in, back navigation and app switching. Marketing web must work at phone/desktop widths; native journeys require native testing.
