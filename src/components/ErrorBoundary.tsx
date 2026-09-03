import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught React Error in Controle de Vencimentos:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleResetData = async () => {
    try {
      localStorage.clear();
      if (typeof window !== 'undefined' && window.indexedDB) {
        window.indexedDB.deleteDatabase('ControleVencimentosDB_v2');
      }
    } catch (e) {
      console.error('Error clearing storage:', e);
    }
    window.location.reload();
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-red-200 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center text-red-600 shrink-0">
                <AlertTriangle className="w-6 h-6 stroke-[2.5]" />
              </div>
              <div>
                <h1 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                  Recuperação do Sistema
                </h1>
                <p className="text-xs text-slate-500 font-medium">
                  Controle de Vencimentos • Filial 172
                </p>
              </div>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 text-xs text-red-900 space-y-1 font-mono">
              <p className="font-bold">{this.state.error?.name || 'Erro de Execução'}</p>
              <p className="text-[11px] opacity-90 break-words">
                {this.state.error?.message || 'Ocorreu um imprevisto durante a renderização.'}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <button
                onClick={this.handleReload}
                className="w-full py-3 px-4 rounded-xl bg-blue-700 hover:bg-blue-800 active:bg-blue-900 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-md"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Recarregar Página</span>
              </button>

              <button
                onClick={this.handleResetData}
                className="w-full py-3 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all border border-slate-300"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Restaurar Base</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}


