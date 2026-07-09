import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

/**
 * Heartbeat interval (ms). The client writes `lastSeen` to Convex every ~10s.
 * The TTL sweep (cron, every 5s) flips any doc whose `lastSeen` is older than
 * 30s to offline — so a live client stays online, a crashed one resolves
 * within ~30–35s (Decision D3).
 */
const HEARTBEAT_MS = 10_000;
/** Max status text length (must match convex/presence.ts). */
const MAX_STATUS_LEN = 128;
/** Debounce window for status writes (ms). */
const STATUS_DEBOUNCE_MS = 300;
/** Timeout for the best-effort `goOffline` mutation on close/logout (ms). */
const GO_OFFLINE_TIMEOUT_MS = 2_000;

export interface UsePresenceResult {
  /** The user's current status text (read reactively from the presence list). */
  myStatus: string;
  /** The caller's Convex `users._id`, once resolved. `null` until `getMyUser` lands. */
  userId: Id<"users"> | null;
  /** Update the status text (debounced ~300ms before writing to Convex). */
  setStatus: (text: string) => void;
  /** Explicit teardown: stop the heartbeat + mark offline. Idempotent. */
  goOffline: () => Promise<void>;
}

/**
 * Presence lifecycle hook (Phase 2 — Decision D3, D6).
 *
 * On mount (when `discordId` is provided): resolves the caller's `users._id`
 * via the reactive `getMyUser` query (TG6), then calls `setOnline` and starts
 * a ~10s heartbeat. On unmount / `goOffline` / log out: clears the interval
 * and calls `setOffline` (best-effort).
 *
 * Strict-mode-safe: the heartbeat effect clears any existing interval before
 * starting a new one, so the dev double-mount produces a single heartbeat.
 *
 * @param discordId - the authenticated user's Discord ID (from Phase 1 `User.id`)
 */
export function usePresence(discordId: string | null): UsePresenceResult {
  console.log("[usePresence] called with discordId:", discordId);
  const setOnline = useMutation(api.presence.setOnline);
  const heartbeat = useMutation(api.presence.heartbeat);
  const setStatusMutation = useMutation(api.presence.setStatus);
  const setOffline = useMutation(api.presence.setOffline);

  // TG6: reactive lookup of the caller's users._id by discordId.
  const myUser = useQuery(api.presence.getMyUser, discordId ? { discordId } : "skip");
  console.log("[usePresence] myUser:", myUser);
  const userId = myUser?._id ?? null;
  console.log("[usePresence] userId:", userId);

  // Reactive presence list — used to surface the caller's current status text
  // for the status input (so edits from another device reflect here too).
  const presenceList = useQuery(api.presence.listPresence, {});
  console.log("[usePresence] presenceList:", presenceList);
  const myRow = presenceList?.find((p) => p.discordId === discordId) ?? null;
  const myStatus = myRow?.status ?? "";

  // Local optimistic status state + debounce timer for writes.
  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Heartbeat interval handle + idempotency flag for goOffline.
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleanedRef = useRef(false);

  // Heartbeat effect: starts when userId becomes available.
  useEffect(() => {
    console.log("[usePresence] heartbeat effect — userId:", userId, "discordId:", discordId);
    if (!userId || !discordId) {
      console.log("[usePresence] heartbeat effect: skipping (no userId or discordId)");
      return;
    }

    // Strict-mode-safe: clear any existing interval first.
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    cleanedRef.current = false;

    // Mark online + start the heartbeat.
    setOnline({ userId, discordId }).catch((e) => console.error("presence setOnline failed:", e));

    intervalRef.current = setInterval(() => {
      heartbeat({ userId }).catch((e) =>
        // Best-effort; the TTL sweep is the offline backstop if writes drop.
        console.error("presence heartbeat failed:", e),
      );
    }, HEARTBEAT_MS);

    // Cleanup on unmount or userId change: stop heartbeat + mark offline.
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (!cleanedRef.current) {
        cleanedRef.current = true;
        // Fire-and-forget — the Convex client (at root) is still alive during
        // React unmount. This is the backstop for Rust-initiated teardown
        // (discord:needs-login / discord:logged-out events).
        setOffline({ userId }).catch((e) =>
          console.error("presence setOffline (cleanup) failed:", e),
        );
      }
    };
  }, [userId, discordId, setOnline, heartbeat, setOffline]);

  // Debounced status write.
  const setStatus = useCallback(
    (text: string) => {
      const trimmed = text.slice(0, MAX_STATUS_LEN);
      // Optimistic local state for the input.
      setLocalStatus(trimmed);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        if (userId) {
          setStatusMutation({ userId, status: trimmed }).catch((e) =>
            console.error("presence setStatus failed:", e),
          );
        }
      }, STATUS_DEBOUNCE_MS);
    },
    [userId, setStatusMutation],
  );

  // Clear the debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Explicit teardown — called by App.tsx before logout / window close.
  const goOffline = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (cleanedRef.current || !userId) {
      cleanedRef.current = true;
      return;
    }
    cleanedRef.current = true;

    // Best-effort with a timeout — don't hang the close/logout forever.
    try {
      await Promise.race([
        setOffline({ userId }),
        new Promise<void>((resolve) => setTimeout(resolve, GO_OFFLINE_TIMEOUT_MS)),
      ]);
    } catch (e) {
      console.error("presence goOffline failed:", e);
    }
  }, [userId, setOffline]);

  // The input shows the optimistic local value while editing, else the live value.
  const displayedStatus = localStatus !== null ? localStatus : myStatus;

  return { myStatus: displayedStatus, userId, setStatus, goOffline };
}
