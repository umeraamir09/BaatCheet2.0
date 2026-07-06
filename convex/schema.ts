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
});
