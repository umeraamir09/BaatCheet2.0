import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  counter: defineTable({
    value: v.number(),
  }),
  users: defineTable({
    discordId: v.string(),
    username: v.string(),
    displayName: v.union(v.string(), v.null()),
    avatarUrl: v.string(),
    updatedAt: v.number(),
  }).index("byDiscordId", ["discordId"]),
  // Phase 2 — Presence (Decision D1). Separate table to avoid thrashing the
  // rarely-changing users doc with ~10s heartbeat writes. Keyed by userId
  // (FK to users) + denormalized discordId for client-side self-matching.
  presence: defineTable({
    userId: v.id("users"),
    discordId: v.string(),
    status: v.string(), // free-text, self-set (D2). "" if none. Persists across sessions.
    online: v.boolean(), // binary Online/Offline (D2). Idle/DND deferred.
    lastSeen: v.number(), // ms epoch — heartbeat timestamp
  })
    .index("byUser", ["userId"])
    .index("byDiscordId", ["discordId"]),
  // Phase 3 — 1:1 DM text (Decisions D1, D3). Generic conversation + message
  // tables so Phase 5's group lobby is a `type:"group"` doc reusing `messages`,
  // not a second table (D1). `key` is the canonical sorted "userIdA__userIdB"
  // so both DM participants resolve to the same conversation doc.
  conversations: defineTable({
    type: v.string(), // "dm" now; "group" lands Phase 5
    participantIds: v.array(v.id("users")), // exactly 2 for a DM, stored sorted
    key: v.string(), // canonical sorted "userIdA__userIdB"
    createdAt: v.number(),
    lastMessageAt: v.number(), // DM-list ordering; init = createdAt
  })
    .index("byKey", ["key"]) // unique upsert/lookup path
    .index("byLastMessage", ["lastMessageAt"]), // DM-list ordering
  messages: defineTable({
    conversationId: v.id("conversations"),
    senderId: v.id("users"),
    body: v.string(),
    // Rich messaging — optional fields (backward-compatible with existing messages)
    attachments: v.optional(
      v.array(
        v.union(
          v.object({
            kind: v.literal("image"),
            storageId: v.id("_storage"),
            contentType: v.string(),
            width: v.union(v.number(), v.null()),
            height: v.union(v.number(), v.null()),
          }),
          v.object({
            kind: v.literal("gif"),
            url: v.string(),
            width: v.union(v.number(), v.null()),
            height: v.union(v.number(), v.null()),
            alt: v.union(v.string(), v.null()),
          }),
        ),
      ),
    ),
    linkPreview: v.optional(
      v.union(
        v.object({
          url: v.string(),
          title: v.union(v.string(), v.null()),
          description: v.union(v.string(), v.null()),
          imageUrl: v.union(v.string(), v.null()),
          siteName: v.union(v.string(), v.null()),
          fetchedAt: v.number(),
        }),
        v.null(),
      ),
    ),
    createdAt: v.number(),
  }).index("byConversation", ["conversationId", "createdAt"]), // ordered history
  // Phase 3 — Typing indicators (Decision D3). No cron: stale docs are
  // invisible via the recency filter in `listTyping` (lastTyped > now - 3000).
  typing: defineTable({
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    lastTyped: v.number(),
  }).index("byConversation", ["conversationId"]),
  // Phase 4 — 1:1 voice (Decisions D1, D3). A `calls` doc is the single
  // source of truth for call state — both sides subscribe via `getCall(callId)`.
  // Signaling (SDP offer/answer + trickled ICE) flows through Convex (D1).
  // Status transitions are idempotent (guard on current status) so concurrent
  // ends from both sides don't double-transition.
  calls: defineTable({
    callerId: v.id("users"),
    calleeId: v.id("users"),
    status: v.string(), // "calling" | "accepted" | "rejected" | "ended" | "missed"
    offerSdp: v.string(),
    answerSdp: v.union(v.string(), v.null()),
    callerIceCandidates: v.array(v.string()), // JSON-encoded RTCIceCandidateInit
    calleeIceCandidates: v.array(v.string()),
    startedAt: v.number(),
    connectedAt: v.union(v.number(), v.null()),
    endedAt: v.union(v.number(), v.null()),
    endReason: v.union(v.string(), v.null()),
  })
    .index("byCallee", ["calleeId", "startedAt"]) // incoming-call toast subscription
    .index("byCaller", ["callerId", "startedAt"]),
});
