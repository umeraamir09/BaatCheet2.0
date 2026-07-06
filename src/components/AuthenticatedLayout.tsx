import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { usePresence } from "../hooks/usePresence";
import { PresenceSidebar } from "./PresenceSidebar";
import type { User } from "../auth";

const SIDEBAR_COLLAPSED_KEY = "baatcheet.sidebar.collapsed";

interface AuthenticatedLayoutProps {
  user: User;
  onLogout: () => Promise<void> | void;
}

/**
 * Phase-2 layout: collapsible left sidebar rail + the Phase-1 post-auth main
 * content (Decision D5 — sidebar is the only new chrome).
 *
 * Owns: the `usePresence` instance (so `goOffline` is available for the logout
 * button + window-close handler), the sidebar collapse state (localStorage —
 * a UI pref, not a credential), and the Tauri `onCloseRequested` listener that
 * fires `goOffline` before the window closes (TG9).
 */
export function AuthenticatedLayout({ user, onLogout }: AuthenticatedLayoutProps) {
  console.log("[AuthenticatedLayout] mount — user:", user.id, "discordId:", user.id);
  const presence = usePresence(user.id);
  console.log("[AuthenticatedLayout] presence:", { userId: presence.userId, myStatus: presence.myStatus });

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
        // localStorage may be unavailable (private mode, etc.) — non-fatal.
      }
      return next;
    });
  }, []);

  // Logout orchestration (TG10): stop heartbeat + setOffline BEFORE clearing
  // tokens. The usePresence unmount cleanup is the backstop for Rust-initiated
  // teardown (discord:needs-login / discord:logged-out fired without the button).
  const handleLogout = useCallback(async () => {
    await presence.goOffline();
    await onLogout();
  }, [presence, onLogout]);

  // TG9: Tauri window close-requested → fire goOffline before destroying the
  // window. `event.preventDefault()` blocks the close; `win.destroy()` then
  // closes for real (avoids re-triggering the close-requested event).
  // Backstop: the TTL sweep (cron, 30–35s) if the mutation doesn't land in time.
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
      />
      <main className="flex flex-1 flex-col items-center justify-center gap-6">
        <h1 className="text-4xl font-bold">BaatCheet</h1>
        <img
          src={user.avatarUrl}
          alt={`${user.username} avatar`}
          className="h-24 w-24 rounded-full"
        />
        <div className="text-center">
          <p className="text-xl font-semibold">{user.displayName ?? user.username}</p>
          <p className="text-sm text-gray-400">@{user.username}</p>
        </div>
        <p className="text-sm text-green-500">Logged in successfully</p>
        <button
          onClick={handleLogout}
          className="text-sm text-gray-400 hover:text-white"
        >
          Log out
        </button>
      </main>
    </div>
  );
}
