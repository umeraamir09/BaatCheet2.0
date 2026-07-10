import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const STALE_MS = 45_000;

export const list = query({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_MS;
    const entries = (await ctx.db.query("voicePresence").collect()).filter((entry) => entry.lastSeen >= cutoff);
    return await Promise.all(entries.map(async (entry) => {
      const user = await ctx.db.get(entry.userId);
      return { ...entry, user: user ? { displayName: user.displayName, username: user.username, avatarUrl: user.avatarUrl } : null };
    }));
  },
});

export const join = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const existing = await ctx.db.query("voicePresence").withIndex("byUser", (q) => q.eq("userId", userId)).unique();
    const now = Date.now();
    if (existing) await ctx.db.patch(existing._id, { lastSeen: now });
    else await ctx.db.insert("voicePresence", { userId, joinedAt: now, lastSeen: now });
  },
});

export const leave = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const existing = await ctx.db.query("voicePresence").withIndex("byUser", (q) => q.eq("userId", userId)).unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});
