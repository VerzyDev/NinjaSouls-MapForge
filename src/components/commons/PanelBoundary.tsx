import React from 'react';

interface PanelBoundaryProps {
  label: string;
  children: React.ReactNode;
}

interface PanelBoundaryState {
  error: Error | null;
}

class PanelBoundary extends React.Component<PanelBoundaryProps, PanelBoundaryState> {
  state: PanelBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PanelBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`${this.props.label} panel crashed:`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full w-full flex-col overflow-hidden rounded-lg bg-card shadow-island">
        <div className="flex h-7 flex-shrink-0 items-center border-b border-border/50 bg-secondary/80 px-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">{this.props.label}</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <p className="text-xs text-destructive">This panel failed to render.</p>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[10px] text-muted-foreground">
            {error.message || String(error)}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-3 rounded border border-border/50 bg-card/60 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-item-hover hover:text-foreground"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
}

export default PanelBoundary;
