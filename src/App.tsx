import { useAuth } from "./hooks/useAuth";
import { AuthenticatedLayout } from "./components/AuthenticatedLayout";

function App() {
  const { status, user, error, login, logout } = useAuth();

  console.log("[App] render — status:", status, "user:", user ? { id: user.id, username: user.username } : null, "error:", error);

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