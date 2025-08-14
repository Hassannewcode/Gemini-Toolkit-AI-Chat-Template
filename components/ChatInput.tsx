import React, { useState, useRef, useCallback, useEffect } from 'react';
import { SendIcon, StopIcon, PaperclipIcon, XMarkIcon } from './icons';

interface ChatInputProps {
  onSendMessage: (text: string, files: File[]) => void;
  onStop: () => void;
  isStreaming: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSendMessage, onStop, isStreaming }) => {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    if (isStreaming || (!text.trim() && files.length === 0)) return;
    onSendMessage(text, files);
    setText('');
    setFiles([]);
  }, [isStreaming, text, files, onSendMessage]);

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
    // Reset file input to allow selecting the same file again
    event.target.value = '';
  };

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
      {files.length > 0 && (
        <div className="p-2 border-b border-border">
          <div className="flex flex-wrap gap-2">
            {files.map((file, index) => (
              <div key={index} className="relative bg-background p-1.5 rounded-lg flex items-center gap-2 text-xs">
                {file.type.startsWith('image/') ? (
                   <img src={URL.createObjectURL(file)} alt={file.name} className="w-8 h-8 rounded-md object-cover" />
                ) : (
                   <div className="w-8 h-8 rounded-md bg-accent-hover flex items-center justify-center">
                     <PaperclipIcon className="w-4 h-4 text-text-secondary"/>
                   </div>
                )}
                <span className="text-text-secondary truncate max-w-[120px]">{file.name}</span>
                <button onClick={() => handleRemoveFile(index)} className="absolute -top-1 -right-1 bg-border text-text-secondary rounded-full p-0.5 hover:bg-red-500/50 hover:text-text-primary">
                    <XMarkIcon className="w-3 h-3"/>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-end w-full p-2">
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileChange}
          className="hidden" 
          multiple 
          accept="image/*,text/*,.pdf,.csv,.json,.md,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isStreaming || files.length >= 20}
          className="p-2 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:bg-accent-hover"
          aria-label="Attach file"
        >
          <PaperclipIcon className="w-6 h-6" />
        </button>
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
          disabled={isStreaming || (!text.trim() && files.length === 0)}
          className="p-2 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:bg-accent-hover"
          aria-label="Send message"
        >
          <SendIcon className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};