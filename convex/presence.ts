/**
 * Phase 2 — Presence functions (Decision D1, D2, D3, D6).
 *
 * Presence mutations are PUBLIC (no Convex auth middleware), keyed by
 * userId/discordId. v1 LIMITATION (Decision D7): a misbehaving client could
 * spoof another user's presence by passing that user's userId. Acceptable for
 * v1 (≤10 trusted friends, Convex Cloud dev backend). Hardening (Convex auth
 * or signed writes) is deferred. Inherits Phase 1 D-impl-3 posture.
 *
 * Storage: a separate `presence` table keyed by `userId` (FK to `users`),
 * denormalized `discordId` for client-side self-matching. Heartbeats patch
 * `presence`, not `users` — keeps the rarely-changing profile doc clean.
 *
 * Offline detection (D3): client writes `lastSeen` every ~10s; a cron
 * `sweepOffline` (see convex/cron.ts) flips any doc whose `lastSeen` is older
 * than 30s to `online:false`. Graceful close sets `online:false` immediately.
 */
import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";

/** Max length of the self-set status string (D2). Enforced server-side. */
const MAX_STATUS_LEN = 128;
/** A presence doc is considered stale after this many ms without a heartbeat. */
const STALE_MS = 30_000;

/**
 * Look up the caller's `users` doc by Discord ID (Phase 2 task 4.1).
 *
 * Returns the full users doc (incl. `_id`) or `null`. The frontend uses this
 * to learn its Convex `users._id` for presence writes (Decision D1). Reactive:
 * if `upsertUser` hasn't committed yet at session restore, returns `null`
 * briefly then updates live once it lands.
 */
export const getMyUser = query({
  args: { discordId: v.string() },
  handler: async (ctx, args): Promise<Doc<"users"> | null> => {
    return await ctx.db
      .query("users")
      .withIndex("byDiscordId", (q) => q.eq("discordId", args.discordId))
      .unique();
  },
});

/**
 * Reactive presence feed for the sidebar (Decision D6).
 *
 * Returns all presence docs joined with their `users` profile, sorted:
 * online first, then alpha by displayName (fallback username). No polling —
 * Convex reactive subscription; appear/disappear + status edits propagate live.
 */
export const listPresence = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("presence").collect();

    // Join each presence doc with its user profile (≤10 docs → ≤10 db.get).
    const joined = await Promise.all(
      docs.map(async (p) => {
        const user = await ctx.db.get(p.userId);
        return {
          _id: p._id,
          userId: p.userId,
          discordId: p.discordId,
          status: p.status,
          online: p.online,
          lastSeen: p.lastSeen,
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

    // Sort: online first, then alpha by displayName (fallback username).
    return joined.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      const an = (a.user?.displayName ?? a.user?.username ?? "").toLowerCase();
      const bn = (b.user?.displayName ?? b.user?.username ?? "").toLowerCase();
      return an.localeCompare(bn);
    });
  },
});

/**
 * Mark self online (login / session restore). Upsert the presence doc:
 * if missing, insert with `status: ""`; if present, patch `online:true` +
 * `lastSeen` (preserve existing `status` across sessions — Decision D2).
 */
export const setOnline = mutation({
  args: { userId: v.id("users"), discordId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("presence")
      .withIndex("byUser", (q) => q.eq("userId", args.userId))
      .unique();

    if (existing) {
      // Preserve status — only flip online + lastSeen.
      await ctx.db.patch(existing._id, { online: true, lastSeen: now });
    } else {
      await ctx.db.insert("presence", {
        userId: args.userId,
        discordId: args.discordId,
        status: "",
        online: true,
        lastSeen: now,
      });
    }
  },
});

/**
 * Heartbeat — patch `lastSeen` (and re-assert `online:true`). Called every
 * ~10s by the frontend. Light write (one indexed query + one patch — D3).
 *
 * Re-asserting `online:true` guards against the sweep having flipped a live
 * client during a long GC pause or transient network blip.
 */
export const heartbeat = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const doc = await ctx.db
      .query("presence")
      .withIndex("byUser", (q) => q.eq("userId", args.userId))
      .unique();
    if (!doc) return; // no doc yet — setOnline owns creation
    await ctx.db.patch(doc._id, { online: true, lastSeen: now });
  },
});

/**
 * Set the self-status text (Decision D2). Server-side 128-char cap. Status
 * persists across log out (only `online` flips) so the user doesn't retype.
 */
export const setStatus = mutation({
  args: { userId: v.id("users"), status: v.string() },
  handler: async (ctx, args) => {
    const trimmed = args.status.slice(0, MAX_STATUS_LEN);
    const doc = await ctx.db
      .query("presence")
      .withIndex("byUser", (q) => q.eq("userId", args.userId))
      .unique();
    if (!doc) return;
    await ctx.db.patch(doc._id, { status: trimmed });
  },
});

/**
 * Mark self offline (graceful close / log out / explicit "go offline").
 * Patches `online:false` + `lastSeen`; preserves `status`. Idempotent — safe
 * to call twice (logout + unmount cleanup both fire it).
 */
export const setOffline = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const doc = await ctx.db
      .query("presence")
      .withIndex("byUser", (q) => q.eq("userId", args.userId))
      .unique();
    if (!doc) return;
    await ctx.db.patch(doc._id, { online: false, lastSeen: now });
  },
});

/**
 * Cron sweep (Decision D3) — internal mutation run every ~5s (see cron.ts).
 *
 * Scans all presence docs where `online === true`; for each with `lastSeen`
 * older than STALE_MS (30s), flips to `online:false`. Covers crashed/killed
 * clients that can't write the graceful-close patch. Result: crash-disconnect
 * resolves within ~30–35s (30s staleness + up to 5s until next sweep).
 *
 * Only flips the flag; leaves `status`/`lastSeen` untouched (lastSeen stays
 * at the last heartbeat for forensic value). One scan + N patches (N ≤ 10).
 */
export const sweepOffline = internalMutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    const now = Date.now();
    const docs = await ctx.db.query("presence").collect();
    await Promise.all(
      docs
        .filter((d) => d.online && now - d.lastSeen > STALE_MS)
        .map((d) => ctx.db.patch(d._id, { online: false })),
    );
  },
});
