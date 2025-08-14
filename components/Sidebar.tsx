import React from 'react';
import { PlusIcon } from './icons';
import { Chat } from '../types';

interface SidebarProps {
  chats: Chat[];
  activeChatId: string | null;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ chats, activeChatId, onNewChat, onSelectChat }) => {
  return (
    <aside className="hidden md:flex flex-col w-64 bg-background p-2">
      <div className="p-2 mb-2">
         <button 
           onClick={onNewChat}
           className="w-full flex items-center justify-between p-2 text-sm font-medium text-text-primary bg-surface rounded-lg hover:bg-accent-hover transition-colors border border-border"
         >
           New Chat
           <PlusIcon className="w-5 h-5" />
         </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <nav className="space-y-1 px-2">
          {chats.map(chat => (
            <a 
              key={chat.id}
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onSelectChat(chat.id);
              }}
              className={`block p-2 text-sm rounded-md transition-colors truncate ${
                activeChatId === chat.id 
                ? 'bg-surface text-text-primary font-medium' 
                : 'text-text-secondary hover:text-text-primary hover:bg-surface'
              }`}
            >
              {chat.title}
            </a>
          ))}
        </nav>
      </div>
    </aside>
  );
};
