import React, { useState, useRef, useEffect } from 'react';
import { ShareIcon, UserIcon, CheckIcon, Bars3Icon, SparklesIcon, BoltIcon, ChevronDownIcon } from './icons';
import { ModelType } from '../types';

interface HeaderProps {
    onShare: () => Promise<boolean>;
    hasActiveChat: boolean;
    onMenuClick: () => void;
    activeChatModel?: ModelType;
    currentModel: ModelType;
    onModelChange: (model: ModelType) => void;
    isStreaming: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onShare, hasActiveChat, onMenuClick, activeChatModel, currentModel, onModelChange, isStreaming }) => {
    const [copied, setCopied] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    
    const modelToDisplay = activeChatModel || currentModel;

    const models = [
        { id: 'gemini' as ModelType, name: 'Gemini', icon: <SparklesIcon className="w-5 h-5 text-accent" /> },
        { id: 'unrestrained' as ModelType, name: 'Unrestrained 1.0', icon: <BoltIcon className="w-5 h-5 text-red-400" /> }
    ];
    const selectedModel = models.find(m => m.id === modelToDisplay);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const handleShareClick = async () => {
        const success = await onShare();
        if (success) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    }
    
    const handleModelSelect = (model: ModelType) => {
        onModelChange(model);
        setIsDropdownOpen(false);
    }

    return (
        <header className="flex items-center justify-between p-2 h-16 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-2 md:gap-4">
                <button
                    onClick={onMenuClick}
                    className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface transition-colors md:hidden"
                    aria-label="Open menu"
                >
                    <Bars3Icon className="w-6 h-6" />
                </button>
                <div ref={dropdownRef} className="relative">
                    <button
                        onClick={() => setIsDropdownOpen(prev => !prev)}
                        disabled={isStreaming}
                        className="flex items-center gap-2.5 px-4 py-2 bg-surface rounded-lg border border-border text-sm font-medium text-text-primary hover:bg-accent-hover transition-colors disabled:opacity-50"
                    >
                        {selectedModel?.icon}
                        <span className="min-w-[120px] text-left">{selectedModel?.name}</span>
                        <ChevronDownIcon className={`w-4 h-4 text-text-secondary transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {isDropdownOpen && (
                        <div className="absolute top-full mt-2 w-full bg-surface border border-border rounded-lg shadow-2xl p-1.5 z-10 animate-slide-down-and-fade">
                            <ul className="space-y-1">
                                {models.map(model => (
                                    <li key={model.id}>
                                        <button
                                            onClick={() => handleModelSelect(model.id)}
                                            className="w-full flex items-center gap-3 text-left px-3 py-2 text-sm rounded-md text-text-primary hover:bg-accent-hover"
                                        >
                                            <span className="w-5 h-5 flex items-center justify-center">{model.icon}</span>
                                            <span className="flex-1">{model.name}</span>
                                            {modelToDisplay === model.id && <CheckIcon className="w-4 h-4 text-accent" />}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
            
            <div className="flex items-center gap-2">
                <button 
                    onClick={handleShareClick}
                    disabled={!hasActiveChat || copied}
                    className="p-2 border border-border rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Share Chat"
                >
                    {copied ? <CheckIcon className="w-5 h-5 text-green-500" /> : <ShareIcon className="w-5 h-5" />}
                </button>
                 <button className="w-9 h-9 flex items-center justify-center bg-surface border border-border rounded-full hover:bg-accent-hover transition-colors duration-200">
                    <UserIcon className="w-5 h-5" />
                 </button>
            </div>
        </header>
    )
}