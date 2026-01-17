import React, { useState } from 'react';
import { deleteFromImgbb } from '../services/imgbb';

interface DeleteImgbbButtonProps {
    deleteUrl: string;
    onDeleted: () => void;
    isTextButton?: boolean;
}

const DeleteImgbbButton: React.FC<DeleteImgbbButtonProps> = ({ deleteUrl, onDeleted, isTextButton = false }) => {
    const [isBusy, setIsBusy] = useState(false);
    const [message, setMessage] = useState('');

    const handleClick = async (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        
        if (isBusy) return;

        setIsBusy(true);
        setMessage('');

        // FIX: Replaced truthiness check on a void-returning function with a try/catch block.
        // The deleteFromImgbb function throws an error on network failure, which is caught here.
        // If it doesn't throw, we assume the request was sent successfully.
        try {
            await deleteFromImgbb(deleteUrl);
            setMessage('Başarıyla silindi.');
            // This will trigger the parent to delete the DB record and unmount this button.
            onDeleted();
        } catch (error) {
            console.error("ImgBB deletion failed:", error);
            // Deletion failed, manual intervention needed.
            const errorMessage = (error as Error)?.message || 'Otomatik silinemedi. Lütfen tekrar deneyin.';
            setMessage(errorMessage);

            // Reset the button so the user can try again if they want.
            setTimeout(() => {
                setIsBusy(false);
                setMessage('');
            }, 3500);
        }
    };

    if (isTextButton) {
        return (
            <button 
                type="button" 
                onClick={handleClick} 
                disabled={isBusy}
                className="text-red-500 hover:text-red-400 disabled:text-gray-500 disabled:cursor-not-allowed"
            >
                {isBusy ? 'Siliniyor...' : message || 'Sil'}
            </button>
        );
    }

    return (
        <div className="absolute top-2 right-2 z-10">
            <button 
                type="button" 
                onClick={handleClick} 
                className="p-2 bg-red-600 text-white rounded-full transition-all hover:bg-red-700 disabled:opacity-50 disabled:cursor-wait"
                aria-label="Afişi Sil"
                disabled={isBusy}
            >
                {isBusy 
                    ? <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    : <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                }
            </button>
            {message && <span className="absolute top-full right-0 mt-1 px-2 py-1 bg-gray-900 text-white text-xs rounded-md shadow-lg">{message}</span>}
        </div>
    );
};

export default DeleteImgbbButton;