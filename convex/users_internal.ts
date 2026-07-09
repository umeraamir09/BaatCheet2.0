import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

/**
 * Internal query to load a user doc.
 * Used by the LiveKit token mint action (which runs in Node.js mode).
 */
export const getUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});
