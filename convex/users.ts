import { mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Upsert a user document keyed by Discord ID.
 * Creates the document if it doesn't exist, or patches it if any field changed.
 *
 * This is a public mutation (no Convex auth middleware) — the Discord ID is
 * the natural key, and Phase 1 doesn't wire Convex auth (Decision D-impl-3).
 *
 * Called by the frontend after:
 * - Fresh login (token exchange + profile fetch complete)
 * - Session restore on cold start (to sync any profile changes)
 */
export const upsertUser = mutation({
  args: {
    discordId: v.string(),
    username: v.string(),
    displayName: v.union(v.string(), v.null()),
    avatarUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("byDiscordId", (q) => q.eq("discordId", args.discordId))
      .unique();

    const now = Date.now();

    if (existing) {
      // Patch only if fields changed (avoid unnecessary writes).
      const needsUpdate =
        existing.username !== args.username ||
        existing.displayName !== args.displayName ||
        existing.avatarUrl !== args.avatarUrl;

      if (needsUpdate) {
        await ctx.db.patch(existing._id, {
          username: args.username,
          displayName: args.displayName,
          avatarUrl: args.avatarUrl,
          updatedAt: now,
        });
      } else {
        // Touch updatedAt even if fields unchanged (signals "user was seen").
        await ctx.db.patch(existing._id, { updatedAt: now });
      }
    } else {
      await ctx.db.insert("users", {
        discordId: args.discordId,
        username: args.username,
        displayName: args.displayName,
        avatarUrl: args.avatarUrl,
        updatedAt: now,
      });
    }
  },
});