import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary to catch React crashes and display the error instead of a
 * blank screen. Logs the error to the console for debugging.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-950 p-8 text-white">
          <h1 className="text-2xl font-bold text-red-500">Something went wrong</h1>
          <pre className="max-w-2xl overflow-auto rounded bg-gray-900 p-4 text-sm text-gray-300">
            {this.state.error?.message}
            {"\n\n"}
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="rounded bg-gray-800 px-4 py-2 text-sm hover:bg-gray-700"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
