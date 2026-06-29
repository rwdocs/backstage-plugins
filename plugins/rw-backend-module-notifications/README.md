# @rwdocs/backstage-plugin-rw-backend-module-notifications

Opt-in backend module that delivers **doc-comment notifications**. It registers a
`CommentProcessor` on `@rwdocs/backstage-plugin-rw-backend`'s comment-processing extension
point (`rwCommentProcessingExtensionPoint`); rw-backend resolves each comment action into a
`CommentActivity` and hands it to the processor, which sends native Backstage notifications:

- **Owner-side:** a new top-level comment on docs owned by a group notifies that group.
- **Commenter-side:** a reply to a thread, or resolution of a thread, notifies all prior
  thread participants (minus the actor).

## Install

This module is the opt-in — install it only if you want comment notifications. It requires
the native notifications + signals plugins in the host app:

```ts
// packages/backend/src/index.ts
backend.add(import("@rwdocs/backstage-plugin-rw-backend-module-notifications"));
backend.add(import("@backstage/plugin-notifications-backend"));
backend.add(import("@backstage/plugin-signals-backend")); // real-time updates
```

```ts
// packages/app/src/App.tsx — add the notifications + signals frontend plugins
```

### Same-backend requirement

This module is wired to rw-backend through an **in-process extension point**, not an event
bus. The processor must therefore run in the **same backend process** as
`@rwdocs/backstage-plugin-rw-backend` (which registers `rwCommentProcessingExtensionPoint`).
There is no `@backstage/plugin-events-backend` dependency and nothing crosses a process
boundary, so no extra package is needed — but a multi-process deployment that splits this
module out from rw-backend would leave its extension-point dependency unsatisfied and is not
supported.

### Notification topics

Each notification is tagged with a stable `topic`, so users can mute individual
kinds from **Settings → Notifications**. The origin is `plugin:rw`; the topics:

| Topic id                  | Covers                               | Suggested label  |
| ------------------------- | ------------------------------------ | ---------------- |
| `comment:thread:created`  | a new top-level comment (owner-side) | New threads      |
| `comment:reply:created`   | a reply to a thread                  | Replies          |
| `comment:thread:resolved` | a thread being resolved              | Resolved threads |

Topic ids are a frozen contract: lowercase, colon-delimited, never renamed
(they are persisted in the per-user settings key hash).

Backstage lists a topic in a user's settings only after the first notification
carrying it is received. To make all three toggles appear up-front, pre-declare
them (and set defaults) in `app-config.yaml`:

```yaml
notifications:
  defaultSettings:
    channels:
      - id: Web
        enabled: true
        origins:
          - id: plugin:rw
            enabled: true # required by the config schema
            topics:
              - id: comment:thread:created
                enabled: true
              - id: comment:reply:created
                enabled: true
              - id: comment:thread:resolved
                enabled: true
```

Supply human-readable labels via the settings card's `originNames` / `topicNames`
props (see `packages/app/src/notificationSettings.tsx` in this repo). Stale topics
are cleaned up by `notifications.retention` (default `1y`).

### Coalescing & burst control

Each notification carries a coalescing `scope`. The backend dedups on
`(user, scope, origin)`, overwriting the prior row in place rather than adding a new
one. The two sides use different scope namespaces:

- **Owner-side** (a new top-level comment → the owning group): **per-page**
  (`rw:page:<siteRef>|<pageRef>`). A burst of new comments on one doc collapses into a
  **single self-updating notification** — the row shows the latest event, last-write-wins.
  This is the flood control: an owning group accumulates one inbox row per doc, not one per
  comment, during a hot-doc burst.
- **Participant-side** (replies + resolves → prior participants): **per-thread**
  (`rw:comment:<rootId>`), so each thread keeps its own self-updating row.

The owner-side notification therefore reads as _"which docs need attention"_ (doc-level); the
**Comments inbox tab** remains the _"what specifically"_ worklist. Note: Backstage re-fires the
realtime `new_notification` signal on every event even when it only updates an existing row, so
the Web badge still blinks per event (one row, repeated signal).

### Optional: Slack delivery

The official `@backstage/plugin-notifications-backend-module-slack` (a first-party
`NotificationProcessor`) delivers these same notifications to Slack with **no code change
here** — install and configure it in the host backend:

```ts
// packages/backend/src/index.ts
backend.add(import("@backstage/plugin-notifications-backend-module-slack"));
```

```yaml
# app-config.yaml
notifications:
  processors:
    slack:
      - token: ${SLACK_BOT_TOKEN}
```

Resolve a recipient to a Slack target via a `slack.com/bot-notify` annotation (Slack
user/channel ID, recommended), with a fallback to `spec.profile.email` →
`users.lookupByEmail` for User entities.

Because this module already routes owner-side notifications to a **group** and
participant-side to **users**, the Slack module's routing falls out for free:

- A **group** recipient → **one post to that team's Slack channel**.
- A **user** recipient → a **DM**.

Note: the per-page coalescing above is a property of the Web inbox; the Slack module does not
fold a hot-doc burst into a single channel post, so owner-side bursts still produce one channel
message per comment. Time-windowed digests, quiet hours, and per-user frequency caps are not
native to Backstage and are out of scope for this module.

### Notes

- Notification links resolve into the entity's RW docs tab at the comment anchor.
- If you don't install this module, rw-backend simply has no comment processor registered;
  commenting is unaffected and no notifications are sent.
