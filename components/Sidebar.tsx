
import React from 'react';
import type { ViewType } from '../types';
import Logo from './Logo';

interface SidebarProps {
    activeView: ViewType;
    setActiveView: (view: ViewType) => void;
    pendingAffiliateCount?: number;
    systemEnabled: boolean;
    onToggleSystem: () => void;
}

const navItems: { id: ViewType; label: string }[] = [
    { id: 'dashboard',      label: 'Ana Sayfa' },
    { id: 'autoDiscovery',  label: 'Otomatik Keşif' },
    { id: 'affiliateLinks', label: 'Affiliate Linkler' },
    { id: 'affiliateBot',   label: 'Affiliate Bot' },
    { id: 'dealFinder',     label: 'Fırsat Bul' },
    { id: 'discounts',      label: 'İndirim Ekle' },
    { id: 'brochures',      label: 'Aktüel Yönetimi' },
    { id: 'submissions',    label: 'Gönderi Onayı' },
    { id: 'ads',            label: 'Reklam Yönetimi' },
    { id: 'notifications',  label: 'Bildirimler' },
];

const Sidebar: React.FC<SidebarProps> = ({ activeView, setActiveView, pendingAffiliateCount = 0, systemEnabled, onToggleSystem }) => {
    return (
        <aside className="hidden md:flex w-56 bg-gray-800 text-white flex-col border-r border-gray-700/60">
            {/* Logo */}
            <div className="flex items-center justify-center h-16 border-b border-gray-700/60">
                <Logo className="h-8" />
            </div>

            {/* Nav */}
            <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
                {navItems.map((item) => {
                    const isActive = activeView === item.id || (item.id === 'discounts' && activeView === 'manageDiscounts');
                    return (
                        <button
                            key={item.id}
                            onClick={() => setActiveView(item.id)}
                            className={`w-full text-left px-3 py-2 rounded text-sm transition-colors relative ${
                                isActive
                                    ? 'bg-blue-600 text-white font-medium'
                                    : 'text-gray-400 hover:bg-gray-700 hover:text-white'
                            }`}
                        >
                            {item.label}
                            {item.id === 'affiliateLinks' && pendingAffiliateCount > 0 && (
                                <span className="ml-2 bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                                    {pendingAffiliateCount}
                                </span>
                            )}
                        </button>
                    );
                })}
            </nav>

            {/* Sistem Toggle */}
            <div className="p-3 border-t border-gray-700/60">
                <div className="flex items-center justify-between mb-3">
                    <span className={`text-xs font-medium ${systemEnabled ? 'text-green-400' : 'text-red-400'}`}>
                        {systemEnabled ? 'Sistem Aktif' : 'Sistem Kapalı'}
                    </span>
                    <button
                        onClick={onToggleSystem}
                        title={systemEnabled ? 'Sistemi Kapat' : 'Sistemi Aç'}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full focus:outline-none ${systemEnabled ? 'bg-green-500' : 'bg-gray-600'}`}
                    >
                        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-150 ${systemEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>
                <p className="text-[11px] text-center text-gray-600">v1.3.0 Panel</p>
            </div>
        </aside>
    );
};

export default Sidebar;
