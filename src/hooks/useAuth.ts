import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { startDiscordLogin, getCurrentSession, User } from "../auth";

export type AuthStatus =
  "loading" | "idle" | "starting" | "waiting-callback" | "success" | "rejected" | "failed";

export function useAuth() {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const upsertUser = useMutation(api.users.upsertUser);

  // TG5: restore session on cold start.
  useEffect(() => {
    const start = performance.now();
    const logTiming = (label: string) =>
      `${label} [${((performance.now() - start) / 1000).toFixed(2)}s]`;
    console.log(logTiming("[useAuth] Attempting session restore..."));
    getCurrentSession()
      .then((u) => {
        if (u) {
          console.log(logTiming("[useAuth] Session restored successfully:"), {
            id: u.id,
            username: u.username,
            displayName: u.displayName,
            avatarUrl: u.avatarUrl?.slice(0, 60),
          });
          setUser(u);
          setStatus("success");
          // Upsert to sync any profile changes since last login.
          upsertUser({
            discordId: u.id,
            username: u.username,
            displayName: u.displayName,
            avatarUrl: u.avatarUrl,
          }).catch((e) => console.error(logTiming("[useAuth] Convex upsertUser failed:"), e));
        } else {
          console.warn(logTiming("[useAuth] Session restore returned null — no saved session"));
          setStatus("idle");
        }
      })
      .catch((e) => {
        console.error(logTiming("[useAuth] Session restore threw:"), e);
        setError(`Could not restore the saved session: ${String(e)}`);
        setStatus("failed");
      });
  }, [restoreAttempt, upsertUser]);

  function retrySession() {
    setError(null);
    setStatus("loading");
    setRestoreAttempt((attempt) => attempt + 1);
  }

  async function login() {
    setError(null);
    setStatus("starting");
    try {
      await startDiscordLogin();
      setStatus("waiting-callback");
    } catch (e) {
      setError(String(e));
      setStatus("failed");
    }
  }

  async function logout() {
    try {
      await invoke("logout");
      setUser(null);
      setStatus("idle");
    } catch (e) {
      console.error("Logout failed:", e);
    }
  }

  useEffect(() => {
    const unlistenSuccess = listen<User>("discord:login-success", async (event) => {
      const u = event.payload;
      setUser(u);
      setStatus("success");

      // Upsert the user document in Convex (spec task 4.6).
      try {
        await upsertUser({
          discordId: u.id,
          username: u.username,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
        });
      } catch (e) {
        console.error("Convex upsertUser failed:", e);
      }
    });

    const unlistenRejected = listen<string>("discord:login-rejected", (event) => {
      setError(event.payload);
      setStatus("rejected");
    });

    const unlistenFailed = listen<string>("discord:login-failed", (event) => {
      setError(event.payload);
      setStatus("failed");
    });

    const unlistenNeedsLogin = listen("discord:needs-login", () => {
      setUser(null);
      setStatus("idle");
    });

    const unlistenLoggedOut = listen("discord:logged-out", () => {
      setUser(null);
      setStatus("idle");
    });

    return () => {
      unlistenSuccess.then((fn) => fn());
      unlistenRejected.then((fn) => fn());
      unlistenFailed.then((fn) => fn());
      unlistenNeedsLogin.then((fn) => fn());
      unlistenLoggedOut.then((fn) => fn());
    };
  }, [upsertUser]);

  return { status, user, error, login, logout, retrySession };
}
