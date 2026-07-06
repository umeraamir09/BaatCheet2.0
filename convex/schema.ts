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
    createdAt: v.number(),
  }).index("byConversation", ["conversationId", "createdAt"]), // ordered history
  // Phase 3 — Typing indicators (Decision D3). No cron: stale docs are
  // invisible via the recency filter in `listTyping` (lastTyped > now - 3000).
  typing: defineTable({
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    lastTyped: v.number(),
  }).index("byConversation", ["conversationId"]),
});
