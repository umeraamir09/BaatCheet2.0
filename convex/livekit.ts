"use node";
/**
 * Phase 6 — LiveKit token mint (Decisions D3, D11, D13, D16).
 *
 * Token mint is a PUBLIC Convex action (no auth middleware), keyed by userId.
 * v1 LIMITATION (Decision D13): a misbehaving client could pass another user's
 * `userId` and mint a token with their identity, joining the voice room as them.
 * Acceptable for v1 (≤10 trusted friends, Convex Cloud dev backend, self-hosted
 * LiveKit on a private VM). Hardening (Convex auth gating the action, or signed
 * identity) is deferred. Inherits Phase 2 D7 / Phase 3 D4 / Phase 4 D7 /
 * Phase 5 D7 posture.
 *
 * API secret stays server-side (Decision D3): LIVEKIT_API_KEY + LIVEKIT_API_SECRET
 * are read from the Convex deployment environment (set via `bunx convex env add`),
 * NOT from Vite env. The secret never reaches the client. The frontend reads only
 * VITE_LIVEKIT_URL (the public LiveKit server URL).
 *
 * Identity + metadata in the token (Decision D11): identity = users._id (Convex id,
 * consistent with the app's identity model), name = displayName ?? username,
 * metadata = JSON { avatarUrl, displayName, username } so the voice roster can
 * render without a separate Convex lookup.
 *
 * The action returns only { token }; the frontend reads VITE_LIVEKIT_URL from
 * import.meta.env (keeps the action server-pure; the URL is a public frontend
 * value, not a secret).
 *
 * Single fixed room "lobby" (Decision D1/D4): the token grants roomJoin + publish +
 * subscribe for room "lobby" only. No cross-room access. LiveKit auto-starts the
 * room on first connect + auto-empties on last disconnect; there is no create/destroy
 * lifecycle in code.
 */
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { AccessToken } from "livekit-server-sdk";

const LOG_PREFIX = "[convex/livekit]";

/**
 * Mint a LiveKit access token for the given user, scoped to room "lobby".
 *
 * Loads the user doc for name/metadata, builds a JWT via livekit-server-sdk's
 * AccessToken (HS256, v2 async toJwt), returns { token }. Public (Decision D13).
 */
export const mintToken = action({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<{ token: string }> => {
    console.log(`${LOG_PREFIX} mintToken: userId=${args.userId}`);

    const user = await ctx.runQuery(internal.users_internal.getUser, { userId: args.userId });
    if (!user) {
      console.error(`${LOG_PREFIX} mintToken: user not found for id ${args.userId}`);
      throw new ConvexError("User not found");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (globalThis as any).process?.env ?? {};
    const apiKey = env.LIVEKIT_API_KEY as string | undefined;
    const apiSecret = env.LIVEKIT_API_SECRET as string | undefined;
    if (!apiKey || !apiSecret) {
      console.error(
        `${LOG_PREFIX} mintToken: LIVEKIT_API_KEY or LIVEKIT_API_SECRET not set in Convex env`,
      );
      throw new ConvexError(
        "LiveKit API key/secret not set. Set via `bunx convex env add LIVEKIT_API_KEY ...` and `bunx convex env add LIVEKIT_API_SECRET ...`.",
      );
    }

    const identity = args.userId;
    const name = user.displayName ?? user.username;
    const metadata = JSON.stringify({
      avatarUrl: user.avatarUrl,
      displayName: user.displayName,
      username: user.username,
    });

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name,
      metadata,
    });
    at.addGrant({
      room: "lobby",
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();
    console.log(
      `${LOG_PREFIX} mintToken: token minted for identity=${identity}, name=${name}, token.length=${token.length}`,
    );
    return { token };
  },
});
