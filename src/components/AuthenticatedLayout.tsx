import { useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { usePresence } from "../hooks/usePresence";
import { PresenceSidebar } from "./PresenceSidebar";
import { DMThread, EmptyDMState, type PeerProfile } from "./DMThread";
import type { User } from "../auth";

const SIDEBAR_COLLAPSED_KEY = "baatcheet.sidebar.collapsed";
/** Persisted last-opened DM (a UI pref — an id, not a credential). */
const ACTIVE_DM_KEY = "baatcheet.dm.activeConversationId";

interface AuthenticatedLayoutProps {
  user: User;
  onLogout: () => Promise<void> | void;
}

/**
 * Phase-3 layout: collapsible left sidebar (DM-selectable) + DM thread main
 * pane (Decision D2 — 2-pane, no icon rail). Owns the Phase-2 `usePresence`
 * instance, the sidebar collapse state, the active-DM state (lifted here so
 * the sidebar + main pane share it), and the Tauri `onCloseRequested` teardown.
 *
 * Active DM persistence: the last-opened `conversationId` is stored in
 * localStorage so a relaunch lands on the same DM (task 5.3). On logout the
 * key is cleared (no cross-user leakage). On mount, the restored id is
 * validated once against `listMyDMs` (covers a stale id from a crashed
 * session or a different user on the same install).
 */
export function AuthenticatedLayout({ user, onLogout }: AuthenticatedLayoutProps) {
  const presence = usePresence(user.id);
  const getOrCreateDM = useMutation(api.conversations.getOrCreateDM);

  // Reactive DM list — used for the active-peer profile + restore validation.
  // Deduped with PresenceSidebar's own `listMyDMs` subscription by the Convex
  // React client (same query + args → one server subscription).
  const myDMsQuery = useQuery(
    api.conversations.listMyDMs,
    presence.userId ? { userId: presence.userId } : "skip",
  );

  const [activeConversationId, setActiveConversationId] = useState<Id<"conversations"> | null>(
    () => {
      try {
        const v = localStorage.getItem(ACTIVE_DM_KEY);
        return v ? (v as Id<"conversations">) : null;
      } catch {
        return null;
      }
    },
  );
  // `trusted` = the active id came from a user action (selectPeer/selectDM),
  // so it's definitely valid for this user — show it even before myDMs
  // reactively includes a freshly created conversation. A restored id starts
  // untrusted and is validated in-render against myDMs (see below).
  const [trusted, setTrusted] = useState(false);
  const [activePeerUserId, setActivePeerUserId] = useState<Id<"users"> | null>(null);
  // Click-passed peer profile — instant header while myDMs catches up to a
  // freshly created conversation (~1s). Superseded once myDMs resolves it.
  const [pendingPeerProfile, setPendingPeerProfile] = useState<PeerProfile | null>(null);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // localStorage may be unavailable — non-fatal.
      }
      return next;
    });
  }, []);

  // Validate a RESTORED (untrusted) id in render: show it only while myDMs is
  // still loading (optimistic) OR once myDMs confirms the user is a
  // participant. A user-set (trusted) id is always shown — it came from
  // getOrCreateDM/selectDM, so it's valid even before myDMs catches up to a
  // freshly created conversation. This avoids setState-in-effect and the race
  // where a new DM is briefly absent from myDMs.
  const effectiveConversationId = useMemo<Id<"conversations"> | null>(() => {
    if (!activeConversationId) return null;
    if (trusted) return activeConversationId;
    if (myDMsQuery === undefined) return activeConversationId; // still loading
    return myDMsQuery.some((d) => d.conversationId === activeConversationId)
      ? activeConversationId
      : null; // stale / not a participant → hide
  }, [activeConversationId, trusted, myDMsQuery]);

  // Active peer profile: prefer the authoritative DM-list profile; fall back
  // to the click-passed profile for the ~1s before myDMs includes a new DM.
  const activePeerProfile = useMemo<PeerProfile | null>(() => {
    const fromDMs =
      myDMsQuery?.find((d) => d.conversationId === effectiveConversationId)?.peer ?? null;
    return fromDMs ?? pendingPeerProfile;
  }, [myDMsQuery, effectiveConversationId, pendingPeerProfile]);

  // Active peer id: the click-set value (instant highlight) or, on restore,
  // derived from myDMs so the open DM's friend row highlights after relaunch.
  const effectivePeerUserId = useMemo<Id<"users"> | null>(() => {
    if (activePeerUserId) return activePeerUserId;
    const dm = myDMsQuery?.find((d) => d.conversationId === effectiveConversationId);
    return dm?.peerUserId ?? null;
  }, [activePeerUserId, myDMsQuery, effectiveConversationId]);

  // Click a friend row → open/create the DM.
  const selectPeer = useCallback(
    async (peerUserId: Id<"users">, peerProfile: PeerProfile | null) => {
      if (!presence.userId) return;
      setActivePeerUserId(peerUserId);
      setPendingPeerProfile(peerProfile);
      setTrusted(true);
      try {
        const convId = await getOrCreateDM({
          userIdA: presence.userId,
          userIdB: peerUserId,
        });
        setActiveConversationId(convId);
        try {
          localStorage.setItem(ACTIVE_DM_KEY, convId);
        } catch {
          // non-fatal
        }
      } catch (e) {
        console.error("getOrCreateDM failed:", e);
      }
    },
    [presence.userId, getOrCreateDM],
  );

  // Click a DM row → select an existing conversation.
  const selectDM = useCallback(
    (
      conversationId: Id<"conversations">,
      peerUserId: Id<"users">,
      peerProfile: PeerProfile | null,
    ) => {
      setActiveConversationId(conversationId);
      setActivePeerUserId(peerUserId);
      setPendingPeerProfile(peerProfile);
      setTrusted(true);
      try {
        localStorage.setItem(ACTIVE_DM_KEY, conversationId);
      } catch {
        // non-fatal
      }
    },
    [],
  );

  // Logout: stop heartbeat + setOffline BEFORE clearing tokens; clear the DM
  // pref so a different user doesn't land on the previous user's thread.
  const handleLogout = useCallback(async () => {
    await presence.goOffline();
    try {
      localStorage.removeItem(ACTIVE_DM_KEY);
    } catch {
      // non-fatal
    }
    await onLogout();
  }, [presence, onLogout]);

  // Tauri window close-requested → fire goOffline before destroying the
  // window. Backstop: the TTL sweep (30–35s) if the mutation doesn't land.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlistenP = win.onCloseRequested(async (event) => {
      event.preventDefault();
      try {
        await presence.goOffline();
      } catch (e) {
        console.error("window close goOffline failed:", e);
      } finally {
        await win.destroy();
      }
    });
    return () => {
      unlistenP.then((fn) => fn()).catch(() => {});
    };
  }, [presence]);

  return (
    <div className="flex h-screen bg-gray-950 text-white">
      <PresenceSidebar
        presence={presence}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        user={user}
        onLogout={handleLogout}
        activeConversationId={effectiveConversationId}
        activePeerUserId={effectivePeerUserId}
        onSelectPeer={selectPeer}
        onSelectDM={selectDM}
      />
      <main className="flex flex-1 flex-col">
        {effectiveConversationId && presence.userId ? (
          <DMThread
            conversationId={effectiveConversationId}
            myUserId={presence.userId}
            peerProfile={activePeerProfile}
          />
        ) : (
          <EmptyDMState />
        )}
      </main>
    </div>
  );
}
