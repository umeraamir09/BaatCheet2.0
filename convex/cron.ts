/**
 * Phase 2 — Convex cron registration (Decision D3).
 *
 * Registers `sweepOffline` to run every ~5s. The sweep flips any presence doc
 * whose `lastSeen` is older than 30s to `online:false`, covering crashed/killed
 * clients that can't write the graceful-close patch.
 *
 * Result: crash-disconnect resolves within ~30–35s (30s staleness + up to 5s
 * until the next sweep). Graceful close sets `online:false` immediately.
 */
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Run the offline TTL sweep every 5 seconds.
crons.interval("sweepOffline", { seconds: 5 }, internal.presence.sweepOffline);

export default crons;
