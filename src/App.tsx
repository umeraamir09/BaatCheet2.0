import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";

function App() {
  const counter = useQuery(api.counter.get);
  const setCounter = useMutation(api.counter.set);
  const seedCounter = useMutation(api.counter.seed);

  if (counter === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg">Loading…</p>
      </div>
    );
  }

  if (counter === null) {
    seedCounter();
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg">Initializing…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8">
      <h1 className="text-4xl font-bold">BaatCheet</h1>
      <div className="text-6xl font-mono">{counter.value}</div>
      <div className="flex gap-4">
        <button
          onClick={() => setCounter({ value: counter.value - 1 })}
          className="rounded bg-gray-700 px-6 py-3 text-lg hover:bg-gray-600"
        >
          −
        </button>
        <button
          onClick={() => setCounter({ value: counter.value + 1 })}
          className="rounded bg-gray-700 px-6 py-3 text-lg hover:bg-gray-600"
        >
          +
        </button>
      </div>
      <p className="text-sm text-gray-400">
        Edit this value from the Convex dashboard to test reactivity
      </p>
    </div>
  );
}

export default App;
