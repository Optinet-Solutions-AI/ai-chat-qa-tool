'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';

interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmRequest {
  message: string;
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

const ConfirmContext = createContext<(message: string, options?: ConfirmOptions) => Promise<boolean>>(
  () => Promise.resolve(false)
);

export function useConfirm() {
  return useContext(ConfirmContext);
}

export default function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  const confirm = useCallback((message: string, options: ConfirmOptions = {}): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setRequest({ message, options, resolve });
    });
  }, []);

  const handleAnswer = (value: boolean) => {
    request?.resolve(value);
    setRequest(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col">
            <div className="px-6 pt-6 pb-4">
              {request.options.title && (
                <h2 className="text-sm font-semibold text-slate-900 mb-2">{request.options.title}</h2>
              )}
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">{request.message}</p>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100">
              <button
                onClick={() => handleAnswer(false)}
                className="text-sm font-medium text-slate-600 px-4 py-2 rounded-xl hover:bg-slate-100 transition-colors"
              >
                {request.options.cancelLabel ?? 'Cancel'}
              </button>
              <button
                autoFocus
                onClick={() => handleAnswer(true)}
                className={`text-sm font-medium text-white px-4 py-2 rounded-xl transition-colors ${
                  request.options.danger
                    ? 'bg-red-500 hover:bg-red-600'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {request.options.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
