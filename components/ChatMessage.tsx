import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Message, Sender, AIStatus } from '../types';
import { UserIcon, SparklesIcon, CopyIcon, CheckIcon, CodeBracketIcon, EyeIcon, BoltIcon, PlusIcon, PaperclipIcon, SearchIcon } from './icons';

// --- Custom Hooks ---

function useTypewriter(text: string, isStreaming: boolean) {
    const [displayedText, setDisplayedText] = useState('');

    useEffect(() => {
        if (!isStreaming) {
            setDisplayedText(text);
            return;
        }
        
        let i = displayedText.length;
        if (i < text.length) {
            const timeoutId = setTimeout(() => {
                setDisplayedText(text.slice(0, i + 1));
            }, 20); // Adjust delay for speed. 20ms = 50 characters/sec
            
            return () => clearTimeout(timeoutId);
        }
    }, [displayedText, text, isStreaming]);

    useEffect(() => {
        // Reset displayed text when the source text changes (i.e., new message)
        if (!isStreaming) {
             setDisplayedText(text);
        }
    }, [text, isStreaming]);

    return displayedText;
}

// --- Sub-components ---

const BlinkingCursor: React.FC = () => (
    <span className="inline-block w-2 h-4 bg-accent animate-blink" />
);

const AttachmentsPreview: React.FC<{ attachments: Message['attachments'] }> = ({ attachments }) => {
    if (!attachments || attachments.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-2 mb-2">
            {attachments.map((file, index) => (
                <div key={index} className="bg-surface p-1.5 rounded-lg flex items-center gap-2 text-xs border border-border">
                    {file.type.startsWith('image/') ? (
                      <img src={file.data} alt={file.name} className="w-10 h-10 rounded-md object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-accent-hover flex items-center justify-center flex-shrink-0">
                         <PaperclipIcon className="w-5 h-5 text-text-secondary"/>
                      </div>
                    )}
                    <span className="text-text-secondary truncate max-w-[150px]">{file.name}</span>
                </div>
            ))}
        </div>
    );
};

const FileDownloads: React.FC<{ files: Message['files'] }> = ({ files }) => {
    if (!files || files.length === 0) return null;
    
    const handleDownload = (filename: string, content: string) => {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-2 my-4">
            {files.map((file, index) => (
                <button
                    key={index}
                    onClick={() => handleDownload(file.filename, file.content)}
                    className="w-full text-left bg-surface border border-border p-3 rounded-lg flex items-center gap-3 hover:bg-accent-hover transition-colors"
                >
                    <CodeBracketIcon className="w-5 h-5 text-text-secondary flex-shrink-0" />
                    <div className="flex-1">
                        <p className="text-sm font-medium text-text-primary">{file.filename}</p>
                        <p className="text-xs text-text-tertiary">Click to download</p>
                    </div>
                </button>
            ))}
        </div>
    );
};

const ReasoningDisplay: React.FC<{ reasoning: Message['reasoning'], status: AIStatus }> = ({ reasoning, status }) => {
    if (!reasoning && status !== AIStatus.Thinking) return null;
    
    if (status === AIStatus.Thinking || !reasoning) {
         return (
             <div className="flex items-center gap-3 text-sm text-text-secondary animate-pulse my-2">
                 <BoltIcon className="w-4 h-4" />
                 <span>Thinking...</span>
             </div>
         );
    }

    return (
        <details className="text-sm my-4 group bg-black/20 border border-border rounded-lg" open>
            <summary className="cursor-pointer text-text-secondary hover:text-text-primary transition-colors flex items-center justify-between gap-2 p-3">
                <div className="flex items-center gap-2 font-medium">
                    <BoltIcon className="w-4 h-4" />
                    Reasoning
                </div>
                <PlusIcon className="w-4 h-4 group-open:rotate-45 transition-transform" />
            </summary>
            <div className="p-3 border-t border-border space-y-4">
                {reasoning.thought && (
                    <div>
                        <h4 className="font-semibold text-text-primary mb-1">Thought Process</h4>
                        <p className="text-text-secondary whitespace-pre-wrap">{reasoning.thought}</p>
                    </div>
                )}
                 {reasoning.critique && (
                    <div>
                        <h4 className="font-semibold text-text-primary mb-1">Self-Critique</h4>
                        <p className="text-text-secondary whitespace-pre-wrap">{reasoning.critique}</p>
                    </div>
                )}
                {reasoning.plan && Array.isArray(reasoning.plan) && (
                     <div>
                        <h4 className="font-semibold text-text-primary mb-1">Final Plan</h4>
                        <ul className="list-decimal list-inside text-text-secondary space-y-1">
                            {reasoning.plan.map((step, i) => (
                                <li key={i}>{step.step} <span className="text-xs text-text-tertiary font-mono bg-surface px-1 py-0.5 rounded">({step.tool})</span></li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </details>
    );
};


interface CodeBlockProps {
    code: string;
    language: string;
    isComplete: boolean;
    onPreview: (code: string, language: string) => void;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ code, language, isComplete, onPreview }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const handlePreview = () => {
        onPreview(code, language);
    };
    
    const languageDisplayMap: { [key: string]: string } = {
        jsx: 'React (JSX)',
        html: 'HTML',
        python: 'Python',
        'python-api': 'Python API',
    };
    const displayName = languageDisplayMap[language] || language;

    if (!isComplete) {
        return (
            <div className="bg-black/50 rounded-lg my-4 relative border border-border">
                <div className="flex items-center gap-2 p-3 border-b border-border">
                    <CodeBracketIcon className="w-4 h-4 text-text-tertiary" />
                    <span className="text-sm text-text-secondary">{displayName}</span>
                </div>
                <div className="p-4">
                    <div className="flex items-center space-x-2 animate-pulse-fast">
                        <div className="w-2 h-2 bg-text-tertiary rounded-full"></div>
                        <div className="w-2 h-2 bg-text-tertiary rounded-full animation-delay-200"></div>
                        <div className="w-2 h-2 bg-text-tertiary rounded-full animation-delay-400"></div>
                        <span className="text-sm text-text-tertiary">Generating code...</span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-black/50 rounded-lg my-4 relative border border-border">
             <div className="flex items-center justify-between py-1 pr-1 pl-4 border-b border-border">
                <span className="text-xs text-text-tertiary font-mono">{displayName}</span>
                <div className="flex items-center gap-1">
                    <button
                        onClick={handlePreview}
                        className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors p-1 rounded-md"
                        aria-label="Preview code in sandbox"
                    >
                        <EyeIcon className="w-4 h-4" />
                        Preview
                    </button>
                    <button 
                        onClick={handleCopy} 
                        className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors p-1 rounded-md"
                        aria-label={copied ? "Copied code" : "Copy code"}
                    >
                        {copied ? <CheckIcon className="w-4 h-4 text-green-500" /> : <CopyIcon className="w-4 h-4" />}
                        {copied ? 'Copied!' : 'Copy'}
                    </button>
                </div>
            </div>
            <pre className="p-4 text-sm text-text-primary/90 overflow-x-auto">
                <code>{code}</code>
            </pre>
        </div>
    );
};

const MarkdownText: React.FC<{ text: string }> = ({ text }) => {
  const elements: React.ReactNode[] = [];
  const lines = text.split('\n');

  let listItems: React.ReactNode[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(<ul key={`ul-${elements.length}`} className="list-disc list-inside space-y-1 my-2 pl-4">{listItems}</ul>);
      listItems = [];
    }
  };

  const applyInlineFormatting = (textLine: string) => {
    const parts = textLine.split(/(\*\*.*?\*\*|__.*?__|`.*?`|~~.*?~~|\*.*?\*|_.*?_)/g);
    return parts.filter(part => part).map((part, i) => {
      if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
        return <em key={i}>{part.slice(1, -1)}</em>;
      }
      if (part.startsWith('~~') && part.endsWith('~~')) {
        return <s key={i}>{part.slice(2, -2)}</s>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={i} className="bg-surface px-1.5 py-1 rounded text-sm font-mono text-accent">{part.slice(1, -1)}</code>;
      }
      return part;
    });
  };

  lines.forEach((line, lineIndex) => {
    const listMatch = line.match(/^(\s*)(\*|-)\s+(.*)/);
    if (listMatch) {
      const [, , , listItemContent] = listMatch;
      listItems.push(<li key={`li-${lineIndex}`}>{applyInlineFormatting(listItemContent)}</li>);
      return;
    } 
    
    flushList();
    
    if (line.startsWith('# ')) {
      elements.push(<h1 key={lineIndex} className="text-2xl font-bold mt-6 mb-2">{applyInlineFormatting(line.substring(2))}</h1>);
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={lineIndex} className="text-xl font-semibold mt-5 mb-2">{applyInlineFormatting(line.substring(3))}</h2>);
    } else if (line.startsWith('### ')) {
      elements.push(<h3 key={lineIndex} className="text-lg font-semibold mt-4 mb-2">{applyInlineFormatting(line.substring(4))}</h3>);
    } else if (line.trim() === '---') {
      elements.push(<hr key={lineIndex} className="border-border my-4" />);
    } else if (line.startsWith('> ')) {
      elements.push(<blockquote key={lineIndex} className="border-l-4 border-border pl-4 my-2 text-text-secondary italic">{applyInlineFormatting(line.substring(2))}</blockquote>);
    } else if (line.trim() !== '') {
      elements.push(<p key={lineIndex}>{applyInlineFormatting(line)}</p>);
    } else if (elements.length > 0 && !(elements[elements.length - 1] as any).props?.className?.includes('h-4')) {
      elements.push(<div key={lineIndex} className="h-4" />);
    }
  });

  flushList();

  return <>{elements}</>;
};

const GroundingCitations: React.FC<{ metadata: any }> = ({ metadata }) => {
    const chunks = metadata?.groundingChunks;
    if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
        return null;
    }

    const citations = chunks
        .map(chunk => chunk.web)
        .filter(Boolean)
        .reduce((acc: {uri: string, title: string}[], current) => { // Deduplicate by uri
            if (!acc.find(item => item.uri === current.uri)) {
                acc.push(current);
            }
            return acc;
        }, []);
    
    if (citations.length === 0) return null;

    return (
        <div className="mt-6 border-t border-border pt-4">
            <h4 className="text-sm font-semibold text-text-secondary mb-3 flex items-center gap-2">
                <SearchIcon className="w-4 h-4"/>
                Sources
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {citations.map((cite, index) => (
                    <a 
                        key={index} 
                        href={cite.uri} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="block bg-surface p-2.5 rounded-lg hover:bg-accent-hover transition-colors group"
                    >
                        <p className="text-text-primary font-medium truncate group-hover:text-accent">{cite.title || new URL(cite.uri).hostname}</p>
                        <p className="text-text-tertiary truncate">{cite.uri}</p>
                    </a>
                ))}
            </div>
        </div>
    );
};

// --- Main Component ---

export const ChatMessage: React.FC<{ message: Message, onPreviewCode: (code: string, language: string) => void }> = ({ message, onPreviewCode }) => {
  const isUser = message.sender === Sender.User;
  const isStreaming = message.status === AIStatus.Generating && !isUser;
  const displayedText = useTypewriter(message.text, isStreaming);

  const content = useMemo(() => {
      const parts = displayedText.split(/(```[\s\S]*?```)/g);
      
      return parts.map((part, index) => {
          const codeMatch = part.match(/```([\w-]+)?\n?([\s\S]*?)```/);
          if (codeMatch) {
              const language = codeMatch[1] || 'text';
              const code = codeMatch[2] || '';
              // A code block is "complete" if the original, non-typewritten text includes this part entirely.
              const isPartComplete = message.text.includes(part);
              return <CodeBlock key={index} language={language} code={code} isComplete={isPartComplete} onPreview={onPreviewCode} />;
          }
          if (part.trim()) {
              return <MarkdownText key={index} text={part} />;
          }
          return null;
      });
  }, [displayedText, message.text, onPreviewCode]);


  const icon = isUser ? (
      <div className="w-7 h-7 rounded-full flex items-center justify-center bg-surface text-text-secondary border border-border">
        <UserIcon className="w-4 h-4" />
      </div>
  ) : (
      <div className="w-7 h-7 rounded-full flex items-center justify-center bg-surface text-accent border border-border">
        <SparklesIcon className="w-4 h-4" />
      </div>
  );
  
  const showReasoning = !isUser && (message.reasoning || message.status === AIStatus.Thinking);

  return (
    <div className={`flex items-start gap-4 animate-slide-in`}>
      <div className="flex-shrink-0 mt-1">
        {icon}
      </div>
      <div className="flex-1 pt-0.5 min-w-0">
        <AttachmentsPreview attachments={message.attachments} />
        {isUser && <p className="text-text-primary/90 leading-relaxed whitespace-pre-wrap">{message.text}</p>}
        
        {showReasoning && <ReasoningDisplay reasoning={message.reasoning} status={message.status!} />}
        
        {!isUser && (
            <div className="text-text-primary/90 space-y-4 leading-relaxed">
                {content}
                <FileDownloads files={message.files} />
                {isStreaming && message.text.length > 0 && <BlinkingCursor />}
                {!isStreaming && message.groundingMetadata && <GroundingCitations metadata={message.groundingMetadata} />}
            </div>
        )}
        
        {message.status === AIStatus.Error && (
            <p className="text-red-400 text-sm mt-2">An error occurred. Please try again.</p>
        )}
      </div>
    </div>
  );
};