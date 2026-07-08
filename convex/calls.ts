/**
 * Phase 4 — Call functions (Decisions D1, D3, D7, D11).
 *
 * Call mutations are PUBLIC (no Convex auth middleware), keyed by
 * callerId/calleeId/callId. v1 LIMITATION (Decision D7): a misbehaving client
 * could spoof a call, hijack another user's call doc, or inject ICE candidates.
 * Acceptable for v1 (≤10 trusted friends, Convex Cloud dev backend). Hardening
 * (Convex auth or signed writes) is deferred. Inherits Phase 1 D-impl-3 /
 * Phase 2 D7 / Phase 3 D4 posture.
 *
 * Signaling (D1): SDP offer/answer + trickled ICE flow through Convex docs
 * both sides subscribe to. The `calls` doc is the single source of truth.
 *
 * State transitions are idempotent (guard on current status) so concurrent
 * ends from both sides don't double-transition.
 *
 * Busy handling (D11): if a callee is already in a call (status !== idle),
 * the callee's client auto-rejects incoming calls (no toast shown) so the
 * caller gets a fast busy signal.
 */
import { query, mutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { Id } from "./_generated/dataModel";

/**
 * Start a call (caller initiates).
 *
 * Validates callerId !== calleeId; inserts a `calls` doc with status "calling",
 * the offer SDP, and empty ICE arrays. Returns the callId for the caller to
 * subscribe to via `getCall`. Public (Decision D7).
 */
export const startCall = mutation({
  args: {
    callerId: v.id("users"),
    calleeId: v.id("users"),
    offerSdp: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"calls">> => {
    if (args.callerId === args.calleeId) {
      throw new ConvexError("Cannot call yourself");
    }

    const now = Date.now();
    return await ctx.db.insert("calls", {
      callerId: args.callerId,
      calleeId: args.calleeId,
      status: "calling",
      offerSdp: args.offerSdp,
      answerSdp: null,
      callerIceCandidates: [],
      calleeIceCandidates: [],
      startedAt: now,
      connectedAt: null,
      endedAt: null,
      endReason: null,
    });
  },
});

/**
 * Answer a call (callee accepts).
 *
 * Transitions status "calling" → "accepted" (idempotent — ignore if not
 * "calling"). Sets answerSdp + connectedAt. Public.
 */
export const answerCall = mutation({
  args: {
    callId: v.id("calls"),
    answerSdp: v.string(),
  },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call) throw new ConvexError("Call not found");
    if (call.status !== "calling") return; // idempotent

    const now = Date.now();
    await ctx.db.patch(args.callId, {
      status: "accepted",
      answerSdp: args.answerSdp,
      connectedAt: now,
    });
  },
});

/**
 * Reject a call (callee declines).
 *
 * Transitions "calling" → "rejected"; sets endedAt + endReason. Public.
 */
export const rejectCall = mutation({
  args: {
    callId: v.id("calls"),
  },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call) throw new ConvexError("Call not found");
    if (call.status !== "calling") return; // idempotent

    const now = Date.now();
    await ctx.db.patch(args.callId, {
      status: "rejected",
      endedAt: now,
      endReason: "rejected",
    });
  },
});

/**
 * End a call (either side leaves).
 *
 * Transitions "accepted" → "ended"; sets endedAt + endReason. If the call is
 * still "calling" (caller cancels before pickup), transitions to "ended" with
 * endReason "cancelled". Public.
 */
export const endCall = mutation({
  args: {
    callId: v.id("calls"),
    reason: v.string(), // "completed" | "error" | "left" | "cancelled"
  },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call) throw new ConvexError("Call not found");
    if (call.status === "ended" || call.status === "rejected" || call.status === "missed") {
      return; // idempotent
    }

    const now = Date.now();
    await ctx.db.patch(args.callId, {
      status: "ended",
      endedAt: now,
      endReason: args.reason,
    });
  },
});

/**
 * Mark a call as missed (caller's ring timeout).
 *
 * If status is still "calling", transitions to "missed"; sets endedAt +
 * endReason. Called by the caller's client after ~30s with no answer. Public.
 */
export const markMissed = mutation({
  args: {
    callId: v.id("calls"),
  },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call) throw new ConvexError("Call not found");
    if (call.status !== "calling") return; // idempotent

    const now = Date.now();
    await ctx.db.patch(args.callId, {
      status: "missed",
      endedAt: now,
      endReason: "missed",
    });
  },
});

/**
 * Add an ICE candidate (trickle).
 *
 * Appends the JSON-encoded candidate to the caller's or callee's ICE array
 * based on `side`. Idempotent-ish (trickle means duplicates are possible; the
 * client dedups by candidate.candidate string). Public.
 */
export const addIceCandidate = mutation({
  args: {
    callId: v.id("calls"),
    side: v.string(), // "caller" | "callee"
    candidate: v.string(), // JSON-encoded RTCIceCandidateInit
  },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call) throw new ConvexError("Call not found");

    if (args.side === "caller") {
      await ctx.db.patch(args.callId, {
        callerIceCandidates: [...call.callerIceCandidates, args.candidate],
      });
    } else if (args.side === "callee") {
      await ctx.db.patch(args.callId, {
        calleeIceCandidates: [...call.calleeIceCandidates, args.candidate],
      });
    }
  },
});

/**
 * Reactive incoming-call query (powers the toast — Decision D6).
 *
 * Returns the latest `calls` doc where calleeId === calleeId AND status ===
 * "calling", ordered by startedAt desc, take 1. Joins the caller's `users`
 * profile (avatar, displayName, username) so the toast can render caller
 * identity. Decision D11: if the callee is already in a call (status !== idle),
 * the callee's client auto-rejects (no toast shown).
 */
export const listIncomingCalls = query({
  args: {
    calleeId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const call = await ctx.db
      .query("calls")
      .withIndex("byCallee", (q) => q.eq("calleeId", args.calleeId))
      .order("desc")
      .filter((q) => q.eq(q.field("status"), "calling"))
      .first();

    if (!call) return null;

    const caller = await ctx.db.get(call.callerId);
    return {
      _id: call._id,
      callerId: call.callerId,
      calleeId: call.calleeId,
      status: call.status,
      offerSdp: call.offerSdp,
      startedAt: call.startedAt,
      caller: caller
        ? {
            displayName: caller.displayName,
            username: caller.username,
            avatarUrl: caller.avatarUrl,
          }
        : null,
    };
  },
});

/**
 * Reactive call-doc query (the single subscription both sides hold).
 *
 * Returns the full `calls` doc for state transitions + ICE trickle. Public.
 */
export const getCall = query({
  args: {
    callId: v.id("calls"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.callId);
  },
});
