import React from 'react';
import { ShareIcon, UserIcon } from './icons';

export const Header: React.FC = () => {
    return (
        <header className="flex items-center justify-end p-4 h-16">
            <div className="flex items-center gap-2">
                <button className="p-2 border border-border rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface transition-colors">
                    <ShareIcon className="w-5 h-5" />
                </button>
                 <button className="w-8 h-8 flex items-center justify-center bg-surface border border-border rounded-full">
                    <UserIcon className="w-5 h-5" />
                 </button>
            </div>
        </header>
    )
}