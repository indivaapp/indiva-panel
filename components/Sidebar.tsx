
import React from 'react';
import type { ViewType } from '../types';
import Logo from './Logo';

interface SidebarProps {
    activeView: ViewType;
    setActiveView: (view: ViewType) => void;
    pendingAffiliateCount?: number;
}

const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: <span className="text-xl mr-3">🏠</span>, disabled: false },
    { id: 'autoDiscovery', label: 'Otomatik Keşif', icon: <span className="text-xl mr-3">🤖</span>, disabled: false },
    { id: 'affiliateLinks', label: 'Affiliate Linkler', icon: <span className="text-xl mr-3">💰</span>, disabled: false },
    { id: 'dealFinder', label: 'Fırsat Bul', icon: <span className="text-xl mr-3">🔍</span>, disabled: false },
    { id: 'discounts', label: 'İndirim Ekle', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>, disabled: false },
    { id: 'brochures', label: 'Aktüel Yönetimi', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>, disabled: false },
    { id: 'submissions', label: 'Gönderi Onayı', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>, disabled: false },
    { id: 'ads', label: 'Reklam Yönetimi', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-2.236 9.168-5.514C18.332 1.66 18.168 1.5 18 1.5s-.332.16-.496.486C16.375 5.236 12.9 7.5 8.832 7.5H7a4 4 0 01-2.564 6.683z" /></svg>, disabled: false },
    { id: 'notifications', label: 'Bildirimler', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>, disabled: false },
];


const Sidebar: React.FC<SidebarProps> = ({ activeView, setActiveView, pendingAffiliateCount = 0 }) => {
    return (
        // pt-[env(safe-area-inset-top)] eklendi
        <aside className="hidden md:flex w-64 bg-gray-800 text-white flex-col pt-[env(safe-area-inset-top)] border-r border-gray-700">
            <div className="flex items-center justify-center h-24 border-b border-gray-700 shadow-sm bg-gray-900/50">
                <Logo className="h-12" />
            </div>
            <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
                {navItems.map((item) => (
                    <button
                        key={item.id}
                        onClick={() => !item.disabled && setActiveView(item.id as ViewType)}
                        disabled={item.disabled}
                        className={`w-full flex items-center text-left p-3 rounded-md transition-all duration-200 group relative ${item.disabled
                            ? 'text-gray-600 cursor-not-allowed opacity-60'
                            : (activeView === item.id || (item.id === 'discounts' && activeView === 'manageDiscounts'))
                                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50'
                                : 'text-gray-400 hover:bg-gray-700 hover:text-white'
                            }`}
                    >
                        <div className={`transition-transform duration-200 ${!item.disabled && activeView === item.id ? 'scale-110' : !item.disabled ? 'group-hover:scale-110' : ''}`}>
                            {item.icon}
                        </div>
                        <span className="font-medium">{item.label}</span>
                        {/* Affiliate badge */}
                        {item.id === 'affiliateLinks' && pendingAffiliateCount > 0 && (
                            <span className="ml-auto bg-orange-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                                {pendingAffiliateCount}
                            </span>
                        )}
                    </button>
                ))}
            </nav>
            <div className="p-4 border-t border-gray-700 text-xs text-center text-gray-500">
                v1.3.0 Panel
            </div>
        </aside>
    );
};

export default Sidebar;
