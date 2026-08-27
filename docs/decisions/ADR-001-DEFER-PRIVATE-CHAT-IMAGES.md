# ADR-001: Defer Private Delivery for Chat Images

Status: accepted, temporary
Decision date: 2026-08-18
Decision owner: product owner
Revisit no later than: 2026-11-18

## Context

Håfa Recipes lets authenticated users attach cooking images to recipe and general chat. The API stores chat images under user-scoped S3 keys and returns direct HTTPS URLs so the external AI provider can retrieve them.

The preferred long-term design is private object storage with authorized application delivery or short-lived provider-safe access. The product owner does not consider that migration necessary in the immediate remediation cycle and wants to prioritize the other audit findings first.

## Decision

Private/signed delivery for **chat images only** is deferred.

The following remain in scope now:

- chat authentication;
- client-role validation;
- arbitrary remote-URL rejection;
- upload byte/type/dimension limits;
- rate limits and usage budgets;
- prompt safety;
- log redaction;
- account-deletion cleanup;
- clear privacy disclosure.

The exception does not apply to private recipe images. Private recipe media should move to authorized/signed delivery under roadmap task B6.

## Accepted risk

Anyone who obtains a chat-image URL may be able to retrieve the image without authenticating until the object is removed or delivery policy changes.

Possible exposure paths include:

- copied or shared URLs;
- application/provider logs;
- support screenshots;
- device compromise;
- accidental inclusion in analytics or error reports;
- third-party AI-provider processing.

The URLs are therefore bearer-like public references, not an authorization boundary.

## Interim controls

Before or alongside the next safety release:

- [x] Keep high-entropy, non-enumerable object names.
- [x] Keep user-scoped key prefixes.
- [ ] Disable bucket listing and directory-style discovery.
- [x] Do not log full chat-image URLs.
- [ ] Do not include chat-image URLs in analytics.
- [ ] Enforce authenticated upload and chat access.
- [ ] Reject arbitrary remote history URLs; only accept app-owned image references.
- [ ] Enforce file type, decoded byte, and image-dimension limits.
- [x] Delete a user's chat-image prefix during account deletion.
- [x] Delete a conversation's persisted chat images when the user clears it.
- [x] Add a short user-facing notice not to upload sensitive personal information.
- [x] Document actual retention and third-party AI processing in the privacy policy.

Chat images are currently retained with their local conversation. Clearing a
conversation removes the local messages and requests deletion of their remote
images. If that request fails, the app keeps each deletion job and retries it
later; the images can remain available until a retry succeeds. Account deletion
removes the user's complete chat-image prefix. Automatic age-based expiration
remains part of the deferred private-delivery work because expiring an image
while its local message remains would silently break later chat context.

## Revisit triggers

Revisit immediately if any of the following occurs:

- a chat-image privacy or access incident;
- chat images begin storing materially sensitive household, medical, identity, or child-related content;
- chat becomes a paid or shared feature;
- provider forwarding architecture changes;
- a security/privacy review requires private delivery;
- URL leakage is observed in logs, analytics, support, or crash reports;
- the no-later-than date arrives.

## Future implementation direction

When this work is resumed, evaluate:

- a private S3 prefix/bucket;
- short-lived signed read URLs;
- backend/provider proxying that does not make the object generally public;
- automatic deletion after a defined retention period;
- explicit deletion from chat history;
- provider upload/file APIs where they offer a narrower access boundary.

## Consequences

Positive:

- immediate engineering effort remains focused on confirmed public recipe exposure, model retirement, auth isolation, durable jobs, and environment safety;
- current chat image behavior remains compatible with the AI provider.

Negative:

- chat images remain accessible to anyone who obtains their URL;
- this accepted risk must stay visible and cannot be represented as resolved;
- privacy disclosures and interim controls become more important.
