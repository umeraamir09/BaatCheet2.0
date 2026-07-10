import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { usePresence } from "../hooks/usePresence";
import { useCall } from "../hooks/useCall";
import { useGroupVoice } from "../hooks/useGroupVoice";
import { useKeybindPreferences } from "../hooks/useKeybindPreferences";
import { useVoiceKeybinds } from "../hooks/useVoiceKeybinds";
import { PresenceSidebar } from "./PresenceSidebar";
import { DMThread, EmptyDMState, type PeerProfile } from "./DMThread";
import { LobbyThread } from "./LobbyThread";
import { IconRail } from "./IconRail";
import { IncomingCallToast } from "./call/IncomingCallToast";
import { CallControls } from "./call/CallControls";
import { SettingsModal } from "./settings/SettingsModal";
import { MemberPanel } from "./MemberPanel";
import { checkAndInstallUpdate, type UpdateStatus } from "../lib/updater";
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
  const {
    status: callStatus,
    peerUserId: callPeerUserId,
    peerProfile: callPeerProfile,
    muted: callMuted,
    deafened: callDeafened,
    peerMuted: callPeerMuted,
    peerDeafened: callPeerDeafened,
    localSpeaking,
    remoteSpeaking,
    startCall,
    accept: acceptCall,
    reject: rejectCall,
    leave: leaveCall,
    setMuted: setCallMuted,
    setDeafened: setCallDeafened,
    audioRef: callAudioRef,
    incomingCall,
  } = useCall(presence.userId);
  const groupVoice = useGroupVoice(presence.userId);
  const keybinds = useKeybindPreferences();
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
  const [, setCollapsed] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keybindCaptureActive, setKeybindCaptureActive] = useState(false);
  const [callFullscreen, setCallFullscreen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    state: "idle",
    message: "Ready to check the configured local/static endpoint.",
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
  // Retained only while migrating persisted UI preferences from Phase 8.
  void toggleCollapse;

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
      callStatus !== "idle" && callStatus !== "ended" && callPeerUserId === effectivePeerUserId
    );
  }, [callStatus, callPeerUserId, effectivePeerUserId]);

  const callActive = callStatus !== "idle" && callStatus !== "ended";

  const toggleVoiceMute = useCallback(() => {
    if (callActive) {
      setCallMuted(!callMuted);
      return;
    }
    if (groupVoice.connected) {
      groupVoice.setMuted(!groupVoice.muted);
    }
  }, [callActive, callMuted, groupVoice, setCallMuted]);

  const toggleVoiceDeafen = useCallback(() => {
    if (callActive) {
      setCallDeafened(!callDeafened);
      return;
    }
    if (groupVoice.connected) {
      groupVoice.setDeafened(!groupVoice.deafened);
    }
  }, [callActive, callDeafened, groupVoice, setCallDeafened]);

  const shortcutStatus = useVoiceKeybinds({
    preferences: keybinds.preferences,
    captureActive: keybindCaptureActive,
    onToggleMute: toggleVoiceMute,
    onToggleDeafen: toggleVoiceDeafen,
  });

  const checkForUpdates = useCallback(() => {
    void checkAndInstallUpdate(setUpdateStatus);
  }, []);

  // Phase 4 — Start a call with the active peer (Decision D12).
  // Phase 6 — Leave group voice first if connected (Decision D9 — mutual exclusivity).
  const startCallWithPeer = useCallback(
    async (peerUserId: Id<"users">, peerProfile: PeerProfile) => {
      setCallFullscreen(false);
      if (groupVoice.connected) {
        await groupVoice.leave();
      }
      startCall(peerUserId, peerProfile);
    },
    [groupVoice, startCall],
  );

  // Phase 6 — Group voice join/leave wrappers (Decision D9 — mutual exclusivity).
  // joinVoice: leave any active 1:1 call first, then join group voice.
  const joinVoice = useCallback(async () => {
    if (callStatus !== "idle" && callStatus !== "ended") {
      await leaveCall("left");
    }
    await groupVoice.join();
  }, [callStatus, groupVoice, leaveCall]);

  // leaveVoice: leave group voice.
  const leaveVoice = useCallback(() => {
    void groupVoice.leave();
  }, [groupVoice]);

  // Phase 6 — Accept incoming 1:1 call wrapper (Decision D9).
  // Leave group voice first if connected, then accept the 1:1 call.
  const acceptCallWithVoiceLeave = useCallback(async () => {
    setCallFullscreen(false);
    if (groupVoice.connected) {
      await groupVoice.leave();
    }
    await acceptCall();
  }, [acceptCall, groupVoice]);

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
    if (callStatus !== "idle" && callStatus !== "ended") {
      await leaveCall("left");
    }
    await presence.goOffline();
    try {
      localStorage.removeItem(ACTIVE_DM_KEY);
      localStorage.removeItem(VIEW_MODE_KEY);
    } catch {
      // non-fatal
    }
    await onLogout();
  }, [callStatus, groupVoice, leaveCall, presence, onLogout]);

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
        if (callStatus !== "idle" && callStatus !== "ended") {
          console.log("[AuthenticatedLayout] Ending active 1:1 call before close...");
          await Promise.race([
            leaveCall("left"),
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
  }, [callStatus, groupVoice, leaveCall, presence]);

  return (
    <div className="flex h-screen bg-discord-bg text-white">
      {/* Phase 5 — Icon rail (Decision D3). Leftmost element, always visible. */}
      <IconRail viewMode={viewMode} onSelect={setViewModePersisted} />

      <PresenceSidebar
        viewMode={viewMode}
        presence={presence}
        groupVoice={groupVoice}
        onJoinVoice={() => void joinVoice()}
        onLeaveVoice={leaveVoice}
        user={user}
        onLogout={handleLogout}
        onOpenSettings={() => setSettingsOpen(true)}
        activeConversationId={effectiveConversationId}
        activePeerUserId={effectivePeerUserId}
        onSelectPeer={selectPeer}
        onSelectDM={selectDM}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        {viewMode === "lobby" ? (
          lobbyDoc && presence.userId ? (
            // Phase 6 — Side-by-side layout when group voice is active (Decision D6).
            // The Hangout roster lives beneath the sidebar channel, including
            // for users who have not joined. Keep chat full-width here.
            <LobbyThread
              conversationId={lobbyDoc._id}
              myUserId={presence.userId}
              onlineCount={onlineCount}
            />
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
            callPanel={
              callActiveWithPeer ? (
                <CallControls
                  status={callStatus}
                  localProfile={{
                    displayName: user.displayName,
                    username: user.username,
                    avatarUrl: user.avatarUrl,
                  }}
                  peerProfile={callPeerProfile}
                  muted={callMuted}
                  deafened={callDeafened}
                  peerMuted={callPeerMuted}
                  peerDeafened={callPeerDeafened}
                  localSpeaking={localSpeaking}
                  remoteSpeaking={remoteSpeaking}
                  fullscreen={callFullscreen}
                  onToggleFullscreen={() => setCallFullscreen((value) => !value)}
                  onMute={setCallMuted}
                  onDeafen={setCallDeafened}
                  onLeave={() => leaveCall("left")}
                />
              ) : null
            }
          />
        ) : (
          <EmptyDMState />
        )}
      </main>
      {viewMode === "lobby" && <MemberPanel currentUserId={presence.userId} onSelectPeer={selectPeer} />}

      {/* Phase 4 — Incoming call toast (Decision D6, D12). Persists across view modes. */}
      {/* Phase 6 — onAccept wrapped to leave group voice first (Decision D9). */}
      {incomingCall && (
        <IncomingCallToast
          caller={incomingCall.caller}
          onAccept={acceptCallWithVoiceLeave}
          onDecline={rejectCall}
        />
      )}

      {/* Keep remote audio mounted while the user navigates away from the matching DM. */}
      {callActive && <audio ref={callAudioRef} autoPlay className="hidden" />}

      <SettingsModal
        open={settingsOpen}
        keybinds={keybinds.preferences}
        updateStatus={updateStatus}
        shortcutStatus={shortcutStatus}
        onClose={() => {
          setSettingsOpen(false);
          setKeybindCaptureActive(false);
        }}
        onSetBinding={keybinds.setBinding}
        onSetEnabled={keybinds.setEnabled}
        onResetKeybinds={keybinds.reset}
        onCaptureChange={setKeybindCaptureActive}
        onCheckForUpdates={checkForUpdates}
      />
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
