import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { usePresence } from "../hooks/usePresence";
import { useCall } from "../hooks/useCall";
import { useGroupVoice } from "../hooks/useGroupVoice";
import { PresenceSidebar } from "./PresenceSidebar";
import { DMThread, EmptyDMState, type PeerProfile } from "./DMThread";
import { LobbyThread } from "./LobbyThread";
import { IconRail } from "./IconRail";
import { IncomingCallToast } from "./call/IncomingCallToast";
import { CallControls } from "./call/CallControls";
import { VoiceStage } from "./voice/VoiceStage";
import type { User } from "../auth";

const SIDEBAR_COLLAPSED_KEY = "baatcheet.sidebar.collapsed";
/** Persisted last-opened DM (a UI pref — an id, not a credential). */
const ACTIVE_DM_KEY = "baatcheet.dm.activeConversationId";
/** Persisted view mode (a UI pref — "lobby" or "dms", not a credential). */
const VIEW_MODE_KEY = "baatcheet.viewmode";

interface AuthenticatedLayoutProps {
  user: User;
  onLogout: () => Promise<void> | void;
}

/**
 * Phase-6 layout: icon rail + collapsible sidebar + main pane (lobby or DM).
 *
 * Owns the Phase-2 `usePresence` instance, the Phase-4 `useCall` (1:1 voice),
 * the Phase-6 `useGroupVoice` (group voice via LiveKit), the sidebar collapse
 * state, the active-DM state, the view-mode state (Decision D3/D10 — "lobby"
 * or "dms"), the lobby auto-creation (Decision D6), and the Tauri
 * `onCloseRequested` teardown. The floating 1:1 call overlay persists across
 * view-mode switches (Phase 5 D8). Phase 6 adds: the side-by-side lobby layout
 * (voice left, text right — Decision D6), mutual exclusivity between 1:1 and
 * group voice (Decision D9), and group-voice teardown on logout/close (D12).
 *
 * Active DM persistence: the last-opened `conversationId` is stored in
 * localStorage so a relaunch lands on the same DM. On logout both the DM
 * pref and the view-mode pref are cleared (no cross-user leakage).
 */
export function AuthenticatedLayout({ user, onLogout }: AuthenticatedLayoutProps) {
  const presence = usePresence(user.id);
  const call = useCall(presence.userId);
  const groupVoice = useGroupVoice(presence.userId);
  const getOrCreateDM = useMutation(api.conversations.getOrCreateDM);

  // Phase 5 — Lobby auto-creation (Decision D6).
  const getOrCreateLobby = useMutation(api.lobby.getOrCreateLobby);
  const lobbyDoc = useQuery(api.lobby.getLobby, {});
  const lobbyCreatedRef = useRef(false);

  // Reactive presence list — used to check if the active peer is online (Phase 4 D11)
  // and to compute the lobby online count (Phase 5).
  const presenceListRaw = useQuery(api.presence.listPresence, {});

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

  // Phase 5 — View mode state (Decision D10). Default "lobby" on fresh login.
  const [viewMode, setViewMode] = useState<"lobby" | "dms">(() => {
    try {
      return (localStorage.getItem(VIEW_MODE_KEY) as "lobby" | "dms") ?? "lobby";
    } catch {
      return "lobby";
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

  // Phase 5 — View mode persistence (Decision D10).
  const setViewModePersisted = useCallback((mode: "lobby" | "dms") => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // localStorage may be unavailable — non-fatal.
    }
  }, []);

  // Phase 5 — Lobby auto-creation (Decision D6). Fires once per session when
  // presence.userId becomes available. Ref-guarded so re-renders don't re-call.
  useEffect(() => {
    if (presence.userId && !lobbyCreatedRef.current) {
      lobbyCreatedRef.current = true;
      getOrCreateLobby({ userId: presence.userId }).catch((e) =>
        console.error("getOrCreateLobby failed:", e),
      );
    }
  }, [presence.userId, getOrCreateLobby]);

  // Phase 5 — Online count for the lobby header. Includes all online users
  // (including self — group-size-online count for the shared space).
  const onlineCount = useMemo(() => {
    return (presenceListRaw ?? []).filter((p) => p.online).length;
  }, [presenceListRaw]);

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

  // Phase 4 — Check if the active peer is online (Decision D11).
  const peerOnline = useMemo(() => {
    if (!effectivePeerUserId) return false;
    const list = presenceListRaw ?? [];
    const peerPresence = list.find((p) => p.userId === effectivePeerUserId);
    return peerPresence?.online ?? false;
  }, [effectivePeerUserId, presenceListRaw]);

  // Phase 4 — Check if a call is active with the current peer.
  const callActiveWithPeer = useMemo(() => {
    return (
      call.status !== "idle" && call.status !== "ended" && call.peerUserId === effectivePeerUserId
    );
  }, [call.status, call.peerUserId, effectivePeerUserId]);

  // Phase 4 — Start a call with the active peer (Decision D12).
  // Phase 6 — Leave group voice first if connected (Decision D9 — mutual exclusivity).
  const startCallWithPeer = useCallback(
    async (peerUserId: Id<"users">, peerProfile: PeerProfile) => {
      if (groupVoice.connected) {
        await groupVoice.leave();
      }
      call.startCall(peerUserId, peerProfile);
    },
    [call, groupVoice],
  );

  // Phase 6 — Group voice join/leave wrappers (Decision D9 — mutual exclusivity).
  // joinVoice: leave any active 1:1 call first, then join group voice.
  const joinVoice = useCallback(async () => {
    if (call.status !== "idle" && call.status !== "ended") {
      await call.leave("left");
    }
    await groupVoice.join();
  }, [call, groupVoice]);

  // leaveVoice: leave group voice.
  const leaveVoice = useCallback(() => {
    void groupVoice.leave();
  }, [groupVoice]);

  // Phase 6 — Accept incoming 1:1 call wrapper (Decision D9).
  // Leave group voice first if connected, then accept the 1:1 call.
  const acceptCallWithVoiceLeave = useCallback(async () => {
    if (groupVoice.connected) {
      await groupVoice.leave();
    }
    await call.accept();
  }, [call, groupVoice]);

  // Click a friend row → open/create the DM. Phase 5: also switches to "dms"
  // view mode (Decision D3 — cross-navigation from any view).
  const selectPeer = useCallback(
    async (peerUserId: Id<"users">, peerProfile: PeerProfile | null) => {
      if (!presence.userId) return;
      setActivePeerUserId(peerUserId);
      setPendingPeerProfile(peerProfile);
      setTrusted(true);
      setViewModePersisted("dms");
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
    [presence.userId, getOrCreateDM, setViewModePersisted],
  );

  // Click a DM row → select an existing conversation. Phase 5: also switches
  // to "dms" view mode (Decision D3 — cross-navigation).
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
      setViewModePersisted("dms");
      try {
        localStorage.setItem(ACTIVE_DM_KEY, conversationId);
      } catch {
        // non-fatal
      }
    },
    [setViewModePersisted],
  );

  // Logout: end any active voice FIRST (Phase 6 group voice → Phase 4 1:1 call
  // teardown ordering — Decision D12), then stop heartbeat + setOffline BEFORE
  // clearing tokens; clear the DM pref AND view-mode pref so a different user
  // doesn't land on the previous user's thread or view mode.
  const handleLogout = useCallback(async () => {
    // Phase 6 — End group voice before 1:1 call.
    if (groupVoice.connected) {
      await groupVoice.leave();
    }
    // Phase 4 — End any active 1:1 call before going offline.
    if (call.status !== "idle" && call.status !== "ended") {
      await call.leave("left");
    }
    await presence.goOffline();
    try {
      localStorage.removeItem(ACTIVE_DM_KEY);
      localStorage.removeItem(VIEW_MODE_KEY);
    } catch {
      // non-fatal
    }
    await onLogout();
  }, [groupVoice, call, presence, onLogout]);

  // Tauri window close-requested → end any active voice FIRST (Phase 6 group
  // voice → Phase 4 1:1 call teardown ordering — Decision D12), then fire
  // goOffline before destroying the window. Backstop: the TTL sweep (30–35s)
  // if the mutation doesn't land.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlistenP = win.onCloseRequested(async (event) => {
      event.preventDefault();
      console.log("[AuthenticatedLayout] onCloseRequested fired, starting teardown...");
      try {
        // Phase 6 — End group voice before 1:1 call.
        if (groupVoice.connected) {
          console.log("[AuthenticatedLayout] Ending group voice before close...");
          await Promise.race([
            groupVoice.leave(),
            new Promise<void>((resolve) => setTimeout(resolve, 3000)),
          ]);
        }
        // Phase 4 — End any active 1:1 call before going offline.
        if (call.status !== "idle" && call.status !== "ended") {
          console.log("[AuthenticatedLayout] Ending active 1:1 call before close...");
          await Promise.race([
            call.leave("left"),
            new Promise<void>((resolve) => setTimeout(resolve, 3000)),
          ]);
        }
        console.log("[AuthenticatedLayout] Setting presence offline...");
        await Promise.race([
          presence.goOffline(),
          new Promise<void>((resolve) => setTimeout(resolve, 3000)),
        ]);
      } catch (e) {
        console.error("[AuthenticatedLayout] window close teardown failed:", e);
      } finally {
        console.log("[AuthenticatedLayout] Destroying window...");
        try {
          await win.destroy();
        } catch (e) {
          console.error("[AuthenticatedLayout] win.destroy() failed:", e);
        }
      }
    });
    return () => {
      unlistenP.then((fn) => fn()).catch(() => {});
    };
  }, [groupVoice, call, presence]);

  return (
    <div className="flex h-screen bg-discord-bg text-white">
      {/* Phase 5 — Icon rail (Decision D3). Leftmost element, always visible. */}
      <IconRail viewMode={viewMode} onSelect={setViewModePersisted} />

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
        {viewMode === "lobby" ? (
          lobbyDoc && presence.userId ? (
            // Phase 6 — Side-by-side layout when group voice is active (Decision D6).
            // VoiceStage (left, fixed width) + LobbyThread (right, flex-1).
            // When not in voice, full-width LobbyThread (Phase 5 behavior).
            (groupVoice.connected || groupVoice.connecting) ? (
              <div className="flex h-full flex-1">
                <VoiceStage groupVoice={groupVoice} />
                <LobbyThread
                  conversationId={lobbyDoc._id}
                  myUserId={presence.userId}
                  onlineCount={onlineCount}
                  voiceStatus={groupVoice.status}
                  onJoinVoice={joinVoice}
                  onLeaveVoice={leaveVoice}
                />
              </div>
            ) : (
              <LobbyThread
                conversationId={lobbyDoc._id}
                myUserId={presence.userId}
                onlineCount={onlineCount}
                voiceStatus={groupVoice.status}
                onJoinVoice={joinVoice}
                onLeaveVoice={leaveVoice}
              />
            )
          ) : (
            <LobbyLoadingState />
          )
        ) : effectiveConversationId && presence.userId ? (
          <DMThread
            conversationId={effectiveConversationId}
            myUserId={presence.userId}
            peerProfile={activePeerProfile}
            peerUserId={effectivePeerUserId}
            peerOnline={peerOnline}
            startCallWithPeer={startCallWithPeer}
            callActiveWithPeer={callActiveWithPeer}
          />
        ) : (
          <EmptyDMState />
        )}
      </main>

      {/* Phase 4 — Incoming call toast (Decision D6, D12). Persists across view modes. */}
      {/* Phase 6 — onAccept wrapped to leave group voice first (Decision D9). */}
      {call.incomingCall && (
        <IncomingCallToast
          caller={call.incomingCall.caller}
          onAccept={acceptCallWithVoiceLeave}
          onDecline={call.reject}
        />
      )}

      {/* Phase 4 — Floating call controls (Decision D12). Persists across view modes. */}
      {call.status !== "idle" && call.status !== "ended" && (
        <CallControls
          status={call.status}
          peerProfile={call.peerProfile}
          muted={call.muted}
          deafened={call.deafened}
          onMute={call.setMuted}
          onDeafen={call.setDeafened}
          onLeave={() => call.leave("left")}
          audioRef={call.audioRef}
        />
      )}
    </div>
  );
}

/** Loading state while the lobby doc is being created / reactively loading. */
function LobbyLoadingState() {
  return (
    <div className="flex h-full flex-1 items-center justify-center bg-discord-bg text-white/60">
      <p className="text-sm">Loading lobby…</p>
    </div>
  );
}
