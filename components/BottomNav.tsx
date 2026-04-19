
import React from 'react';
import type { ViewType } from '../types';

interface BottomNavProps {
    activeView: ViewType;
    setActiveView: (view: ViewType) => void;
    pendingAffiliateCount?: number;
    pendingSubmissionsCount?: number;
}

const navItems: { id: ViewType; label: string; emoji: string }[] = [
    { id: 'dashboard',      label: 'Ana Sayfa',  emoji: '🏠' },
    { id: 'discounts',      label: 'Düzenle',    emoji: '✏️' },
    { id: 'affiliateBot',   label: 'Bot',        emoji: '🤖' },
    { id: 'submissions',    label: 'Onay',       emoji: '✅' },
    { id: 'notifications',  label: 'Bildirim',   emoji: '🔔' },
];

const BottomNav: React.FC<BottomNavProps> = ({ activeView, setActiveView, pendingAffiliateCount = 0, pendingSubmissionsCount = 0 }) => {
    return (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700/60 z-[1000]">
            <div className="flex pb-[env(safe-area-inset-bottom)]">
                {navItems.map((item) => {
                    const isActive = activeView === item.id || (item.id === 'discounts' && activeView === 'manageDiscounts');
                    const badge =
                        item.id === 'affiliateLinks' ? pendingAffiliateCount :
                        item.id === 'submissions'    ? pendingSubmissionsCount : 0;
                    return (
                        <button
                            key={item.id}
                            onClick={() => setActiveView(item.id)}
                            className={`flex-1 flex flex-col items-center justify-center pt-3 pb-2 relative transition-colors ${
                                isActive ? 'text-blue-400' : 'text-gray-500'
                            }`}
                        >
                            {isActive && (
                                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-blue-400 rounded-full" />
                            )}
                            <span className="text-xl leading-none relative">
                                {item.emoji}
                                {badge > 0 && (
                                    <span className="absolute -top-1 -right-2 bg-orange-500 text-white text-[9px] font-bold px-1 rounded-full leading-tight">
                                        {badge}
                                    </span>
                                )}
                            </span>
                            <span className="text-[10px] mt-1 font-medium">{item.label}</span>
                        </button>
                    );
                })}
            </div>
        </nav>
    );
};

export default BottomNav;
