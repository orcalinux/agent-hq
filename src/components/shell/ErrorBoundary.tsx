import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  scope?: string;
}

interface State {
  error: Error | null;
}

const UI_KEYS = ['agent-hq.layout'];

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Agent HQ] ' + (this.props.scope ?? 'app') + ' crashed:', error, info.componentStack);
  }

  private resetLayout = () => {
    UI_KEYS.forEach((k) => window.localStorage.removeItem(k));
    window.location.reload();
  };

  private resetAll = () => {
    if (!window.confirm('Clear all saved Agent HQ browser data (agents, chat, run history, layout)? Project files and provider connections on disk are not touched.')) return;
    Object.keys(window.localStorage)
      .filter((k) => k.startsWith('agent-hq'))
      .forEach((k) => window.localStorage.removeItem(k));
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const full = !this.props.scope;
    return (
      <div role="alert" className={full ? 'flex h-screen items-center justify-center bg-canvas p-6 text-fg' : 'flex h-full items-center justify-center p-6 text-fg'}>
        <div className="w-full max-w-xl rounded-lg border border-danger/40 bg-surface p-5">
          <h1 className="mb-1 text-[14px] font-semibold text-danger">{this.props.scope ? this.props.scope + ' failed to render' : 'Agent HQ failed to start'}</h1>
          <p className="mb-3 text-[12.5px] text-fg-muted">The error below is what went wrong. Saved browser state from an older version is the usual cause.</p>
          <pre className="mb-4 max-h-48 overflow-auto rounded-md border border-line bg-canvas p-3 font-mono text-[11.5px] whitespace-pre-wrap text-fg">{error.message + '\n' + (error.stack ?? '').split('\n').slice(1, 6).join('\n')}</pre>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => (full ? window.location.reload() : this.setState({ error: null }))} className="h-7 rounded-md border border-line bg-surface-2 px-3 text-[12.5px] hover:bg-surface-3">
              Try again
            </button>
            <button type="button" onClick={this.resetLayout} className="h-7 rounded-md border border-line bg-surface-2 px-3 text-[12.5px] hover:bg-surface-3">
              Reset layout and reload
            </button>
            <button type="button" onClick={this.resetAll} className="h-7 rounded-md border border-danger/40 bg-danger-soft px-3 text-[12.5px] text-danger hover:bg-danger/20">
              Clear saved browser data
            </button>
          </div>
        </div>
      </div>
    );
  }
}
