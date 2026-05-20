import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 p-8">
          <h1 className="font-label text-[18px] font-bold text-foreground">Something went wrong</h1>
          <p className="font-body text-[13px] text-muted-foreground text-center max-w-sm">
            An unexpected error occurred. Refresh the page to continue.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-body text-[13px] font-medium hover:bg-primary/90 transition-colors"
          >
            Refresh page
          </button>
          <details className="mt-4 max-w-lg w-full">
            <summary className="font-body text-[11px] text-muted-foreground cursor-pointer">Error details</summary>
            <pre className="mt-2 p-3 bg-muted rounded text-[10px] text-muted-foreground overflow-auto whitespace-pre-wrap">
              {this.state.error.message}
            </pre>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}
