
import React from 'react';
import type { ViewType } from '../types';

interface BottomNavProps {
    activeView: ViewType;
    setActiveView: (view: ViewType) => void;
    pendingAffiliateCount?: number;
}

const navItems = [
    { id: 'dealFinder', label: 'Fırsat', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>, disabled: false },
    { id: 'affiliateLinks', label: 'Affiliate', icon: <span className="text-xl">💰</span>, disabled: false },
    { id: 'discounts', label: 'Ekle', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>, disabled: false },
    { id: 'brochures', label: 'Aktüel', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>, disabled: false },
    { id: 'submissions', label: 'Onay', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>, disabled: false },
    { id: 'notifications', label: 'Bildirim', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>, disabled: false },
];

const BottomNav: React.FC<BottomNavProps> = ({ activeView, setActiveView }) => {
    return (
        // pb-[env(safe-area-inset-bottom)] eklendi
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 flex justify-around p-2 pb-[env(safe-area-inset-bottom)] z-[1000] safe-area-bottom shadow-2xl">
            {navItems.map((item) => (
                <button
                    key={item.id}
                    onClick={() => !item.disabled && setActiveView(item.id as ViewType)}
                    disabled={item.disabled}
                    className={`flex flex-col items-center justify-center text-xs p-1 rounded-md w-1/6 transition-colors ${item.disabled
                        ? 'text-gray-600 cursor-not-allowed opacity-50'
                        : (activeView === item.id || (item.id === 'discounts' && activeView === 'manageDiscounts'))
                            ? 'text-blue-400'
                            : 'text-gray-400'
                        }`}
                >
                    {item.icon}
                    <span className="mt-1">{item.label}</span>
                </button>
            ))}
        </nav>
    );
};

export default BottomNav;
