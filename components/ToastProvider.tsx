import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
    id: number;
    message: string;
    type: ToastType;
}

interface ToastContextValue {
    showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => { } });

export const useToast = () => useContext(ToastContext);

const toastStyles: Record<ToastType, { bg: string; icon: string }> = {
    success: { bg: 'bg-green-600', icon: '✓' },
    error: { bg: 'bg-red-600', icon: '✕' },
    warning: { bg: 'bg-yellow-500', icon: '⚠' },
    info: { bg: 'bg-blue-600', icon: 'ℹ' },
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const counterRef = useRef(0);

    const showToast = useCallback((message: string, type: ToastType = 'success') => {
        const id = ++counterRef.current;
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3500);
    }, []);

    const removeToast = (id: number) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    };

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            {/* Toast Container */}
            <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none" style={{ maxWidth: '320px' }}>
                {toasts.map(toast => {
                    const style = toastStyles[toast.type];
                    return (
                        <div
                            key={toast.id}
                            className={`${style.bg} text-white px-4 py-3 rounded-lg shadow-xl flex items-start gap-3 pointer-events-auto
                                animate-[slideIn_0.2s_ease-out]`}
                            style={{ animation: 'slideIn 0.2s ease-out' }}
                        >
                            <span className="font-bold text-lg leading-none mt-0.5 flex-shrink-0">{style.icon}</span>
                            <p className="text-sm flex-1 leading-snug">{toast.message}</p>
                            <button
                                onClick={() => removeToast(toast.id)}
                                className="text-white/70 hover:text-white flex-shrink-0 leading-none text-lg"
                            >
                                ×
                            </button>
                        </div>
                    );
                })}
            </div>
            <style>{`
                @keyframes slideIn {
                    from { opacity: 0; transform: translateX(100%); }
                    to   { opacity: 1; transform: translateX(0); }
                }
            `}</style>
        </ToastContext.Provider>
    );
};
