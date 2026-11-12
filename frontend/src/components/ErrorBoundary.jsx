import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 bg-white border border-rose-200 m-4 rounded shadow-sm text-slate-800 space-y-4">
          <div className="flex items-center gap-3 text-rose-600">
            <AlertTriangle className="w-6 h-6 flex-shrink-0" />
            <div>
              <h3 className="text-base font-bold">Something went wrong in this view</h3>
              <p className="text-xs text-slate-500">
                A component error was caught safely without crashing the application.
              </p>
            </div>
          </div>

          <div className="bg-rose-50 border border-rose-100 p-3 rounded font-mono text-xs text-rose-800 overflow-x-auto">
            {this.state.error?.toString() || 'Unknown error'}
          </div>

          <button
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#008792] hover:bg-[#007680] text-white text-xs font-semibold rounded transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Try Again / Reload View</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

