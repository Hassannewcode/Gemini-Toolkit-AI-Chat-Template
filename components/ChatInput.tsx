import React, { useState, useRef, useCallback, useEffect } from 'react';
import { SendIcon, StopIcon } from './icons';

interface ChatInputProps {
  onSendMessage: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSendMessage, onStop, isStreaming }) => {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    if (isStreaming || !text.trim()) return;
    onSendMessage(text);
    setText('');
  }, [isStreaming, text, onSendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = '0px';
      const scrollHeight = el.scrollHeight;
      el.style.height = `${Math.min(scrollHeight, 160)}px`; // Max height of 160px
    }
  }, [text]);
  
  if (isStreaming) {
    return (
        <div className="flex justify-center animate-fade-in">
            <button
                onClick={onStop}
                className="flex items-center justify-center gap-2 bg-surface hover:bg-accent-hover transition-colors border border-border text-text-primary font-medium px-4 py-2 rounded-lg"
            >
                <StopIcon className="w-4 h-4"/>
                Stop generating
            </button>
        </div>
    );
  }

  return (
    <div className="bg-surface rounded-xl border border-border focus-within:ring-2 focus-within:ring-accent/50 animate-fade-in">
      <div className="flex items-end w-full p-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          className="flex-1 bg-transparent resize-none p-2 text-text-primary placeholder-text-secondary focus:outline-none"
          rows={1}
          disabled={isStreaming}
          aria-label="Chat input"
        />
        <button
          onClick={handleSend}
          disabled={isStreaming || !text.trim()}
          className="p-2 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:bg-accent-hover"
          aria-label="Send message"
        >
          <SendIcon className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};