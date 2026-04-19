
import React, { useState, useEffect } from 'react';

type Props = {
  onDelete: () => Promise<void>;
  isTextButton?: boolean;
}

const DeleteImgButton: React.FC<Props> = ({ onDelete, isTextButton = false }) => {
    const [status, setStatus] = useState<'idle' | 'confirm' | 'deleting'>('idle');
    const [error, setError] = useState<string | null>(null);

    // Reset confirm status if user doesn't click within 3 seconds
    useEffect(() => {
        if (status === 'confirm') {
            const timer = setTimeout(() => setStatus('idle'), 3000);
            return () => clearTimeout(timer);
        }
    }, [status]);

    const handleClick = async (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        if (status === 'deleting') return;

        if (status === 'idle') {
            setStatus('confirm');
            return;
        }

        if (status === 'confirm') {
            setStatus('deleting');
            setError(null);
            
            try {
                await onDelete();
                // Component will likely unmount here if successful
            } catch (err: any) {
                setError('Hata!');
                setStatus('idle');
                alert(`Silinemedi: ${err.message}`);
            }
        }
    };
    
    if (isTextButton) {
        return (
            <button 
                type="button" 
                onClick={handleClick} 
                disabled={status === 'deleting'}
                className={`
                    transition-colors font-medium cursor-pointer relative z-10 select-none
                    ${status === 'confirm' ? 'text-red-700 font-bold animate-pulse' : 'text-red-500 hover:text-red-400'}
                    ${status === 'deleting' ? 'text-gray-500 cursor-not-allowed' : ''}
                `}
            >
                {status === 'idle' && 'Sil'}
                {status === 'confirm' && 'Emin misin?'}
                {status === 'deleting' && 'Siliniyor...'}
                {error && <span className="text-xs ml-1">{error}</span>}
            </button>
        );
    }

    return (
        <div className="absolute top-2 right-2 z-10">
            <button
                type="button"
                onClick={handleClick}
                disabled={status === 'deleting'}
                className={`
                    flex items-center justify-center shadow-lg cursor-pointer transition-all duration-200
                    ${status === 'confirm' ? 'w-24 rounded-md bg-red-700' : 'w-8 h-8 rounded-full bg-red-600 hover:bg-red-700 hover:scale-110'}
                    disabled:opacity-50 disabled:cursor-wait
                `}
                title={status === 'idle' ? "Sil" : "Onaylamak için tekrar tıklayın"}
            >
                {status === 'idle' && (
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                )}
                
                {status === 'confirm' && (
                    <span className="text-xs text-white font-bold px-2 whitespace-nowrap">Onayla?</span>
                )}

                {status === 'deleting' && (
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                )}
            </button>
        </div>
    );
};

export default DeleteImgButton;
