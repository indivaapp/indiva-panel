
import React from 'react';

interface LogoProps {
    className?: string;
    showText?: boolean;
    variant?: 'light' | 'dark';
}

const Logo: React.FC<LogoProps> = ({ className = "h-10", showText = true, variant = 'light' }) => {
    const textColor = variant === 'light' ? 'text-white' : 'text-gray-900';

    return (
        <div className={`flex items-center gap-3 ${className}`}>
            {/* AVC Logo Image */}
            <img
                src="/avc-logo.png"
                alt="AVC Logo"
                className="h-full w-auto object-contain"
            />

            {/* Logo Text */}
            {showText && (
                <div className="flex flex-col justify-center">
                    <h1 className={`font-bold text-2xl tracking-wider leading-none ${textColor}`}>
                        AVC
                    </h1>
                    <span className={`text-[10px] font-semibold tracking-[0.2em] uppercase opacity-70 ${textColor}`}>
                        Yönetim Paneli
                    </span>
                </div>
            )}
        </div>
    );
};

export default Logo;

