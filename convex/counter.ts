import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("counter").first();
  },
});

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("counter").first();
    if (!existing) {
      await ctx.db.insert("counter", { value: 0 });
    }
  },
});

export const set = mutation({
  args: { value: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("counter").first();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value });
    } else {
      await ctx.db.insert("counter", { value: args.value });
    }
  },
});
