import { useAuth } from "./hooks/useAuth";
import { AuthenticatedLayout } from "./components/AuthenticatedLayout";

function App() {
  const { status, user, error, login, logout, retrySession } = useAuth();

  console.log(
    "[App] render — status:",
    status,
    "user:",
    user ? { id: user.id, username: user.username } : null,
    "error:",
    error,
  );

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg">Loading…</p>
      </div>
    );
  }

  if (status === "success" && user) {
    console.log("[App] rendering AuthenticatedLayout for user:", user.id);
    return <AuthenticatedLayout user={user} onLogout={logout} />;
  }

  const statusText = {
    idle: "Continue with Discord",
    starting: "Opening browser…",
    "waiting-callback": "Waiting for Discord consent…",
    rejected: "Login rejected",
    failed: "Login failed",
    success: "Logged in",
  }[status];

  const isDisabled = status === "starting" || status === "waiting-callback";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6">
      <img
        src="/icons.png"
        alt="BaatCheet logo"
        width={120}
        height={120}
        draggable={false}
        className="logo-anim h-30 w-30 cursor-pointer rounded-2xl shadow-lg shadow-black transition-all duration-300 ease-out hover:scale-105 hover:shadow-xl hover:shadow-discord-light-blurple/30 active:scale-95"
      />
      <div className="flex flex-col items-center gap-1">
        <h1 className="text-4xl font-bold tracking-tight">BaatCheet</h1>
        <p className="text-xs uppercase tracking-[0.2em] text-white/50">by Umroo Productions</p>
      </div>
      <button
        onClick={login}
        disabled={isDisabled}
        className="inline-flex items-center gap-2 rounded-md bg-discord-blurple px-6 py-3 text-base font-medium text-white shadow-sm transition-all duration-150 hover:bg-discord-blurple-hover hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-discord-blurple focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-discord-blurple disabled:hover:shadow-sm disabled:active:scale-100"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 fill-current"
        >
          <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
        <span>{statusText}</span>
      </button>
      {status === "failed" && (
        <button
          type="button"
          onClick={retrySession}
          className="rounded-md border border-discord-border px-4 py-2 text-sm text-discord-text hover:bg-discord-control"
        >
          Retry saved session
        </button>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

export default App;
