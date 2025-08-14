import React, { useEffect, useRef } from 'react';
import { MenuItem } from '../types';

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    // Use timeout to prevent the context menu click from closing the menu immediately
    const timeoutId = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    
    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const handleItemClick = (item: MenuItem) => {
    if (!('action' in item)) return;
    
    if(item.disabled) return;

    item.action();
    onClose();
  };
  
  const menuStyle = {
    top: `${y}px`,
    left: `${x}px`,
  };

  if (menuRef.current) {
    const { innerWidth, innerHeight } = window;
    const { offsetWidth, offsetHeight } = menuRef.current;
    if (x + offsetWidth > innerWidth) {
        menuStyle.left = `${x - offsetWidth}px`;
    }
    if (y + offsetHeight > innerHeight) {
        menuStyle.top = `${y - offsetHeight}px`;
    }
  }

  return (
    <div
      ref={menuRef}
      style={menuStyle}
      className="fixed z-50 w-56 bg-surface border border-border rounded-lg shadow-2xl p-1.5 animate-scale-in origin-top-left"
      onContextMenu={(e) => e.preventDefault()} // Prevent stacking context menus
    >
      <ul className="space-y-1">
        {items.map((item, index) => {
          if (!('action' in item)) {
            return <li key={`sep-${index}`}><div className="h-px bg-border my-1" /></li>;
          }
          
          return (
            <li key={item.label}>
              <button
                onClick={() => handleItemClick(item)}
                disabled={item.disabled}
                className="w-full flex items-center gap-3 text-left px-3 py-2 text-sm rounded-md text-text-primary hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                {item.icon && <span className="w-5 h-5 flex items-center justify-center text-text-secondary">{item.icon}</span>}
                <span className="flex-1">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};