import { useAuth } from "./hooks/useAuth";

function App() {
  const { status, user, error, login, logout } = useAuth();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg">Loading…</p>
      </div>
    );
  }

  if (status === "success" && user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6">
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
        <button onClick={logout} className="text-sm text-gray-400 hover:text-white">
          Log out
        </button>
      </div>
    );
  }

  const statusText = {
    idle: "Continue with Discord",
    starting: "Opening browser…",
    "waiting-callback": "Waiting for Discord consent…",
    rejected: "Login rejected",
    failed: "Login failed",
    success: "Logged in",
  }[status];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-4xl font-bold">BaatCheet</h1>
      <button onClick={login} disabled={status === "starting" || status === "waiting-callback"}>
        {statusText}
      </button>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

export default App;