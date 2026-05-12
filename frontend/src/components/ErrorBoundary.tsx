import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (import.meta.env.DEV) console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
          <div className="max-w-md w-full glass-card rounded-2xl p-6 sm:p-8 text-center space-y-4">
            <div className="text-4xl">!</div>
            <h1 className="text-xl font-bold text-white">Something went wrong</h1>
            <p className="text-slate-400 text-sm">
              {this.state.error?.message?.slice(0, 200) || 'An unexpected error occurred.'}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="bg-sky-500/20 text-sky-400 border border-sky-500/30 px-4 py-2 rounded-lg text-sm font-medium hover:bg-sky-500/30 transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 transition-colors"
              >
                Reload Page
              </button>
            </div>
            <p className="text-slate-600 text-xs">
              If this persists, try disconnecting your wallet and reconnecting.
            </p>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
