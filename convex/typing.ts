/**
 * Phase 3 — Typing indicator functions (Decisions D3, D4, D6).
 *
 * Typing mutations are PUBLIC (no Convex auth middleware), keyed by
 * conversationId + userId. v1 LIMITATION (Decision D4): a misbehaving client
 * could spoof another user's typing. Acceptable for v1 (≤10 trusted friends,
 * Convex Cloud dev backend). Hardening deferred. Inherits Phase 1 D-impl-3 /
 * Phase 2 D7 posture.
 *
 * No cron (D3): stale `typing` docs are invisible via the recency filter in
 * `listTyping` (`lastTyped > now - 3000`). The indicator clears ~3s after the
 * peer stops typing without a sweep. Orphan docs accumulate (one per
 * participant who ever typed) but the table stays tiny (≤10 users × their
 * DMs); a sweep can be added later if it grows — not a v1 leak.
 *
 * Debounce: the client calls `setTyping` on keystroke debounced ~300ms (see
 * `useDMThread`), NOT per keystroke — validation.md:41.
 */
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/** A typing doc is considered stale after this many ms without an update. */
const TYPING_RECENCY_MS = 3_000;

/**
 * Upsert the caller's typing doc for a conversation (Task 3.1).
 *
 * Sets `lastTyped = now` on the (conversationId, userId) doc — patch if it
 * exists, insert if missing. Called on keystroke (debounced ~300ms
 * client-side). Public (Decision D4).
 */
export const setTyping = mutation({
  args: {
    conversationId: v.id("conversations"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    // Within-conversation scan (≤~2 typing docs per conversation at this scale).
    const docs = await ctx.db
      .query("typing")
      .withIndex("byConversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();
    const existing = docs.find((d) => d.userId === args.userId);

    if (existing) {
      await ctx.db.patch(existing._id, { lastTyped: now });
    } else {
      await ctx.db.insert("typing", {
        conversationId: args.conversationId,
        userId: args.userId,
        lastTyped: now,
      });
    }
  },
});

/**
 * Reactive typing feed for a conversation (Task 3.2) — powers "… is typing".
 *
 * Returns `typing` docs for the conversation whose `lastTyped` is within
 * TYPING_RECENCY_MS (3s), EXCLUDING the caller's own doc (the UI shows the
 * peer typing, not self). Each joined with the user's profile. Stale docs are
 * invisible by filter — no cron needed (D3). Subscribed live — the indicator
 * appears/disappears within ~1s/~3s (smoke 3).
 *
 * Public (Decision D4).
 */
export const listTyping = query({
  args: {
    conversationId: v.id("conversations"),
    selfUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const docs = await ctx.db
      .query("typing")
      .withIndex("byConversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();

    const recent = docs.filter(
      (d) => d.userId !== args.selfUserId && now - d.lastTyped < TYPING_RECENCY_MS,
    );

    return await Promise.all(
      recent.map(async (t) => {
        const user = await ctx.db.get(t.userId);
        return {
          userId: t.userId,
          lastTyped: t.lastTyped,
          user: user
            ? {
                displayName: user.displayName,
                username: user.username,
                avatarUrl: user.avatarUrl,
              }
            : null,
        };
      }),
    );
  },
});
