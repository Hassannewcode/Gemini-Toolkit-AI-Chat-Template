import React, { useState } from 'react';
import { Message, Sender, AIStatus } from '../types';
import { UserIcon, SparklesIcon, CopyIcon, CheckIcon } from './icons';

const CodeBlock: React.FC<{ code: string }> = ({ code }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <div className="bg-black/50 rounded-lg my-2 relative border border-border">
            <div className="flex justify-end p-2 border-b border-border">
                <button 
                    onClick={handleCopy} 
                    className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
                    aria-label={copied ? "Copied code" : "Copy code"}
                >
                    {copied ? <CheckIcon className="w-4 h-4 text-green-500" /> : <CopyIcon className="w-4 h-4" />}
                    {copied ? 'Copied!' : 'Copy code'}
                </button>
            </div>
            <pre className="p-4 text-sm text-text-primary/90 overflow-x-auto">
                <code>{code}</code>
            </pre>
        </div>
    );
};

const ThinkingPlaceholder: React.FC = () => (
  <div className="flex items-center space-x-2 animate-pulse-fast">
    <div className="w-2 h-2 bg-text-tertiary rounded-full"></div>
    <div className="w-2 h-2 bg-text-tertiary rounded-full animation-delay-200"></div>
    <div className="w-2 h-2 bg-text-tertiary rounded-full animation-delay-400"></div>
  </div>
);

export const ChatMessage: React.FC<{ message: Message }> = ({ message }) => {
  const isUser = message.sender === Sender.User;

  const formattedText = message.text.split(/(```[\s\S]*?```)/g).map((part, index) => {
    const codeMatch = part.match(/```(?:[\w-]+)?\n([\s\S]*?)```/);
    if (codeMatch && codeMatch[1]) {
      return <CodeBlock key={index} code={codeMatch[1]} />;
    }
    if (!part.startsWith('```') && part.trim()) {
        return part.split('\n').map((line, i) => (
            <p key={`${index}-${i}`}>{line}</p>
        ));
    }
    return null;
  });
  
  const icon = isUser ? (
      <div className="w-7 h-7 rounded-full flex items-center justify-center bg-surface text-text-secondary border border-border">
        <UserIcon className="w-4 h-4" />
      </div>
  ) : (
      <div className="w-7 h-7 rounded-full flex items-center justify-center bg-surface text-accent border border-border">
        <SparklesIcon className="w-4 h-4" />
      </div>
  );
  
  const showThinkingPlaceholder = message.text.length === 0 && message.status && [AIStatus.Thinking, AIStatus.Searching, AIStatus.Generating].includes(message.status);

  return (
    <div className={`flex items-start gap-4 animate-slide-in`}>
      <div className="flex-shrink-0 mt-1">
        {icon}
      </div>
      <div className="flex-1 pt-0.5">
        <div className="text-text-primary/90 space-y-4 leading-relaxed">
            {formattedText}
            {showThinkingPlaceholder && <ThinkingPlaceholder />}
        </div>
      </div>
    </div>
  );
};