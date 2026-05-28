'use client';
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type ToastType = 'success' | 'error' | 'warning' | 'info';
interface ToastItem { id: string; message: string; type: ToastType; }

const ToastContext = createContext<{ toast: (msg: string, type?: ToastType) => void }>({ toast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `t${++counter.current}`;
    setToasts(prev => [...prev.slice(-3), { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={cn(
            'pointer-events-auto px-4 py-2.5 rounded-lg text-sm font-mono shadow-xl border max-w-sm',
            t.type === 'success' && 'bg-green-950 text-green-100 border-green-800',
            t.type === 'error'   && 'bg-red-950 text-red-100 border-red-800',
            t.type === 'warning' && 'bg-amber-950 text-amber-100 border-amber-800',
            t.type === 'info'    && 'bg-card text-foreground border-border',
          )}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
