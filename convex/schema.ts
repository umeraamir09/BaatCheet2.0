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
});
