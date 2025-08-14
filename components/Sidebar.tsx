import React, { useState, useEffect, useRef } from 'react';
import { PlusIcon, PencilIcon, TrashIcon } from './icons';
import { Chat } from '../types';

interface SidebarProps {
  chats: Chat[];
  activeChatId: string | null;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onRenameChat: (id: string, newTitle: string) => void;
  onDeleteChat: (id: string) => void;
  isOpen?: boolean;
  onClose?: () => void;
}

const ChatListItem: React.FC<{
    chat: Chat;
    isActive: boolean;
    onSelect: () => void;
    onRename: (id: string, newTitle: string) => void;
    onDelete: (id: string) => void;
}> = ({ chat, isActive, onSelect, onRename, onDelete }) => {
    const [isRenaming, setIsRenaming] = useState(false);
    const [title, setTitle] = useState(chat.title);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isRenaming && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isRenaming]);
    
    const handleRename = () => {
        if (title.trim() && title.trim() !== chat.title) {
            onRename(chat.id, title.trim());
        }
        setIsRenaming(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleRename();
        } else if (e.key === 'Escape') {
            setTitle(chat.title);
            setIsRenaming(false);
        }
    };

    return (
        <div 
            className={`group relative flex items-center pr-2 rounded-md transition-colors ${isActive ? 'bg-surface' : 'hover:bg-surface/50'}`}
        >
            {isRenaming ? (
                <input
                    ref={inputRef}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={handleRename}
                    onKeyDown={handleKeyDown}
                    className="w-full bg-transparent p-2 text-sm text-text-primary focus:outline-none"
                />
            ) : (
                <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); onSelect(); }}
                    className={`block w-full p-2 text-sm truncate ${isActive ? 'text-text-primary font-medium' : 'text-text-secondary hover:text-text-primary'}`}
                >
                    {chat.title}
                </a>
            )}
            {!isRenaming && (
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center opacity-0 group-hover:opacity-100 transition-opacity bg-surface rounded-md">
                    <button onClick={() => setIsRenaming(true)} className="p-1.5 text-text-secondary hover:text-text-primary"><PencilIcon className="w-4 h-4" /></button>
                    <button onClick={() => onDelete(chat.id)} className="p-1.5 text-text-secondary hover:text-red-400"><TrashIcon className="w-4 h-4" /></button>
                </div>
            )}
        </div>
    );
};


export const Sidebar: React.FC<SidebarProps> = ({ chats, activeChatId, onNewChat, onSelectChat, onRenameChat, onDeleteChat, isOpen, onClose }) => {
  const handleNewChat = () => {
    onNewChat();
    onClose?.();
  };

  const handleSelectChat = (id: string) => {
    onSelectChat(id);
    onClose?.();
  };
    
  return (
    <>
      {/* Mobile Overlay */}
      <div 
        className={`fixed inset-0 bg-black/60 z-30 md:hidden transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Sidebar */}
      <aside 
        className={`flex flex-col w-64 bg-background p-2 transition-transform duration-300 ease-in-out
                   fixed top-0 left-0 h-full z-40 md:relative md:translate-x-0 border-r border-border
                   ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="p-2 mb-2">
           <button 
             onClick={handleNewChat}
             className="w-full flex items-center justify-between p-2 text-sm font-medium text-text-primary bg-surface rounded-lg hover:bg-accent-hover transition-colors border border-border"
           >
             New Chat
             <PlusIcon className="w-5 h-5" />
           </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <nav className="space-y-1 px-2">
            {chats.map(chat => (
              <ChatListItem
                  key={chat.id}
                  chat={chat}
                  isActive={activeChatId === chat.id}
                  onSelect={() => handleSelectChat(chat.id)}
                  onRename={onRenameChat}
                  onDelete={onDeleteChat}
              />
            ))}
          </nav>
        </div>
      </aside>
    </>
  );
};