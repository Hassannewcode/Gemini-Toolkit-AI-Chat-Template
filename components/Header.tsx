import React, { useState } from 'react';
import { ShareIcon, UserIcon, CheckIcon, Bars3Icon } from './icons';

interface HeaderProps {
    onShare: () => Promise<boolean>;
    hasActiveChat: boolean;
    onMenuClick: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onShare, hasActiveChat, onMenuClick }) => {
    const [copied, setCopied] = useState(false);

    const handleShareClick = async () => {
        const success = await onShare();
        if (success) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    }

    return (
        <header className="flex items-center justify-between p-4 h-16 border-b border-border md:border-b-0">
            <button
                onClick={onMenuClick}
                className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface transition-colors md:hidden"
                aria-label="Open menu"
            >
                <Bars3Icon className="w-6 h-6" />
            </button>
            <div className="flex items-center gap-2 ml-auto">
                <button 
                    onClick={handleShareClick}
                    disabled={!hasActiveChat || copied}
                    className="p-2 border border-border rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Share Chat"
                >
                    {copied ? <CheckIcon className="w-5 h-5 text-green-500" /> : <ShareIcon className="w-5 h-5" />}
                </button>
                 <button className="w-8 h-8 flex items-center justify-center bg-surface border border-border rounded-full">
                    <UserIcon className="w-5 h-5" />
                 </button>
            </div>
        </header>
    )
}