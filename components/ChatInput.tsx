import React, { useState, useRef, useCallback, useEffect } from 'react';
import { SendIcon, StopIcon, PaperclipIcon, XMarkIcon, SearchIcon } from './icons';

interface ChatInputProps {
  onSendMessage: (text: string, files: File[], isSearchActive: boolean) => void;
  onStop: () => void;
  isStreaming: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSendMessage, onStop, isStreaming }) => {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    if (isStreaming || (!text.trim() && files.length === 0)) return;
    onSendMessage(text, files, isSearchActive);
    setText('');
    setFiles([]);
    setIsSearchActive(false);
  }, [isStreaming, text, files, isSearchActive, onSendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
  
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      setFiles(prev => [...prev, ...Array.from(event.target.files!)].slice(0, 20)); // Limit to 20 files
    }
    event.target.value = '';
  };

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    if (isStreaming) return;
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault();
      const pastedFiles = Array.from(e.clipboardData.files);
      setFiles(prev => [...prev, ...pastedFiles].slice(0, 20));
    }
  }, [isStreaming]);

  const handleRemoveFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = '0px';
      const scrollHeight = el.scrollHeight;
      el.style.height = `${Math.min(scrollHeight, 160)}px`; // Max height of 160px
    }
  }, [text]);

  return (
    <div onPaste={handlePaste} className={`bg-surface rounded-xl border border-border focus-within:ring-2 focus-within:ring-accent/50 transition-all duration-200 animate-fade-in ${isStreaming ? 'opacity-70' : ''}`}>
      {files.length > 0 && (
        <div className="p-3 border-b border-border">
          <div className="flex flex-wrap gap-2">
            {files.map((file, index) => (
              <div key={`${file.name}-${index}`} className="relative bg-background p-1.5 pl-2 rounded-lg flex items-center gap-2 text-xs animate-scale-in">
                {file.type.startsWith('image/') ? (
                   <img src={URL.createObjectURL(file)} alt={file.name} className="w-8 h-8 rounded-md object-cover" />
                ) : (
                   <div className="w-8 h-8 rounded-md bg-accent-hover flex items-center justify-center">
                     <PaperclipIcon className="w-4 h-4 text-text-secondary"/>
                   </div>
                )}
                <span className="text-text-secondary truncate max-w-[120px]">{file.name}</span>
                <button onClick={() => handleRemoveFile(index)} disabled={isStreaming} className="absolute -top-1.5 -right-1.5 bg-border text-text-secondary rounded-full p-0.5 hover:bg-red-500 hover:text-text-primary transition-all duration-200 disabled:opacity-50">
                    <XMarkIcon className="w-3.5 h-3.5"/>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-end w-full p-1.5">
        <button
          onClick={() => setIsSearchActive(!isSearchActive)}
          disabled={isStreaming}
          className={`p-2.5 rounded-full transition-colors duration-200 ${isSearchActive ? 'bg-blue-500/20 text-blue-300' : 'text-text-secondary enabled:hover:bg-accent-hover enabled:hover:text-text-primary'} disabled:opacity-30 disabled:cursor-not-allowed`}
          aria-pressed={isSearchActive}
          title="Toggle Web Search"
          aria-label="Toggle Web Search"
        >
          <SearchIcon className="w-5 h-5" />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isStreaming || files.length >= 20}
          className="p-2.5 rounded-full text-text-secondary transition-colors duration-200 disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:bg-accent-hover enabled:hover:text-text-primary"
          aria-label="Attach file"
          title="Attach file"
        >
          <PaperclipIcon className="w-5 h-5" />
        </button>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? "AI is generating..." : (isSearchActive ? "Search the web or send a message..." : "Send a message, or paste a file...")}
          className="flex-1 bg-transparent resize-none p-2 mx-1 text-text-primary placeholder-text-secondary focus:outline-none disabled:cursor-not-allowed"
          rows={1}
          disabled={isStreaming}
          aria-label="Chat input"
        />
        {isStreaming ? (
          <button
              onClick={onStop}
              className="p-2.5 rounded-full text-text-secondary transition-all duration-200 bg-red-500/20 text-red-300 hover:bg-red-500/40"
              aria-label="Stop generating"
          >
              <StopIcon className="w-5 h-5"/>
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={(!text.trim() && files.length === 0)}
            className="p-2.5 rounded-full text-text-secondary transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:bg-accent-hover enabled:hover:text-text-primary"
            aria-label="Send message"
          >
            <SendIcon className="w-5 h-5" />
          </button>
        )}
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileChange}
          className="hidden" 
          multiple 
          accept="image/*,text/*,.pdf,.csv,.json,.md,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
          disabled={isStreaming}
        />
      </div>
    </div>
  );
};
