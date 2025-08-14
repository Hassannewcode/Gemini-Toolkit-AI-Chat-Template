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
    
    if (text.length < displayedText.length || !text.startsWith(displayedText)) {
      setDisplayedText(text);
      return;
    }
    
    if (displayedText.length < text.length) {
      const timeoutId = setTimeout(() => {
        setDisplayedText(text.slice(0, displayedText.length + 1));
      }, 5);
      
      return () => clearTimeout(timeoutId);
    }
  }, [text, isStreaming, displayedText]);
  
  useEffect(() => {
    if (!isStreaming) {
      setDisplayedText(text);
    }
  }, [isStreaming, text]);


  return displayedText;
}

// --- Sub-components ---

const BlinkingCursor: React.FC = () => (
    <span className="inline-block w-2.5 h-5 bg-accent animate-blink" />
);

const AttachmentsPreview: React.FC<{ attachments: Message['attachments'] }> = ({ attachments }) => {
    if (!attachments || attachments.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-3 mb-3">
            {attachments.map((file, index) => (
                <div key={index} className="bg-surface p-1.5 rounded-lg flex items-center gap-2.5 text-xs border border-border animate-scale-in" style={{ animationDelay: `${index * 50}ms` }}>
                    {file.type.startsWith('image/') ? (
                      <img src={file.data} alt={file.name} className="w-10 h-10 rounded-md object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-accent-hover flex items-center justify-center flex-shrink-0">
                         <PaperclipIcon className="w-5 h-5 text-text-secondary"/>
                      </div>
                    )}
                    <span className="text-text-secondary truncate max-w-[150px] pr-2">{file.name}</span>
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
        <div className="space-y-3 my-4">
            {files.map((file, index) => (
                <button
                    key={index}
                    onClick={() => handleDownload(file.filename, file.content)}
                    className="w-full text-left bg-surface border border-border p-3 rounded-lg flex items-center gap-4 hover:bg-accent-hover transition-colors duration-200 animate-slide-up-and-fade"
                    style={{ animationDelay: `${index * 75}ms`, animationFillMode: 'backwards' }}
                >
                    <CodeBracketIcon className="w-6 h-6 text-text-secondary flex-shrink-0" />
                    <div className="flex-1 overflow-hidden">
                        <p className="text-sm font-medium text-text-primary truncate">{file.filename}</p>
                        <p className="text-xs text-text-tertiary">Click to download</p>
                    </div>
                </button>
            ))}
        </div>
    );
};

const ReasoningDisplay: React.FC<{ reasoning: Message['reasoning'], status: AIStatus, timing?: Message['timing'] }> = ({ reasoning, status, timing }) => {
    const detailsRef = useRef<HTMLDetailsElement>(null);

    const thought = (reasoning as any)?.step1_analyze_json_input;
    const critique = (reasoning as any)?.step2_reimagine_and_visualize;
    const reviseAndPlan = (reasoning as any)?.step3_revise_and_plan;
    
    const plan = reasoning?.plan;

    if (!reasoning && status !== AIStatus.Thinking) return null;
    
    const initialWaitTime = timing?.initialWait;

    if (status === AIStatus.Thinking || !reasoning) {
         return (
             <div className="flex items-center gap-3 text-sm text-text-secondary animate-pulse-fast my-4">
                 <BoltIcon className="w-5 h-5" />
                 <span>Thinking... {initialWaitTime && `(${initialWaitTime.toFixed(2)}s)`}</span>
             </div>
         );
    }
    
    const hasContent = thought || critique || reviseAndPlan || (plan && plan.length > 0);
    if (!hasContent) return null;
    
    return (
        <details ref={detailsRef} className="text-sm my-4 group bg-black/20 border border-border rounded-lg transition-all duration-300 overflow-hidden animate-fade-in" open>
            <summary className="cursor-pointer text-text-secondary hover:text-text-primary transition-colors flex items-center justify-between gap-2 p-3 list-none">
                <div className="flex items-center gap-3 font-medium">
                    <BoltIcon className="w-5 h-5" />
                    Reasoning
                </div>
                <PlusIcon className="w-5 h-5 group-open:rotate-45 transition-transform duration-300 ease-in-out" />
            </summary>
            <div className="p-4 border-t border-border space-y-4 bg-surface/20">
                {thought && (
                    <div className="animate-slide-down-and-fade">
                        <h4 className="font-semibold text-text-primary mb-1.5 flex justify-between items-center">
                          <span>Step 1: Analysis</span>
                          {timing?.step1 && <span className="text-xs font-mono text-text-tertiary bg-background px-1.5 py-0.5 rounded-full">{timing.step1.toFixed(2)}s</span>}
                        </h4>
                        <p className="text-text-secondary whitespace-pre-wrap leading-relaxed">{thought}</p>
                    </div>
                )}
                 {critique && (
                    <div className="animate-slide-down-and-fade" style={{ animationDelay: '100ms' }}>
                        <h4 className="font-semibold text-text-primary mb-1.5 flex justify-between items-center">
                          <span>Step 2: Reimagine & Visualize</span>
                          {timing?.step2 && <span className="text-xs font-mono text-text-tertiary bg-background px-1.5 py-0.5 rounded-full">{timing.step2.toFixed(2)}s</span>}
                        </h4>
                        <p className="text-text-secondary whitespace-pre-wrap leading-relaxed">{critique}</p>
                    </div>
                )}
                {reviseAndPlan && (
                    <div className="animate-slide-down-and-fade" style={{ animationDelay: '200ms' }}>
                        <h4 className="font-semibold text-text-primary mb-1.5 flex justify-between items-center">
                           <span>Step 3: Revise & Plan</span>
                           {timing?.step3 && <span className="text-xs font-mono text-text-tertiary bg-background px-1.5 py-0.5 rounded-full">{timing.step3.toFixed(2)}s</span>}
                        </h4>
                        <p className="text-text-secondary whitespace-pre-wrap leading-relaxed">{reviseAndPlan}</p>
                    </div>
                )}
                {plan && Array.isArray(plan) && plan.length > 0 && (
                     <div className="animate-slide-down-and-fade" style={{ animationDelay: '300ms' }}>
                        <h4 className="font-semibold text-text-primary mb-2">Final Plan</h4>
                        <ul className="space-y-2">
                            {plan.map((step: any, i: number) => (
                                <li key={i} className="flex items-start gap-3">
                                  <span className="bg-border text-text-tertiary rounded-full w-5 h-5 text-xs flex items-center justify-center flex-shrink-0 mt-0.5">{i+1}</span>
                                  <span>{step.step} <span className="text-xs text-text-tertiary font-mono bg-surface px-1 py-0.5 rounded">({step.tool})</span></span>
                                </li>
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
    const codeRef = useRef<HTMLElement>(null);

    useEffect(() => {
        if (codeRef.current && isComplete && (window as any).hljs) {
            (window as any).hljs.highlightElement(codeRef.current);
        }
    }, [code, language, isComplete]);

    const handleCopy = () => {
        navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };
    
    const isPreviewable = useMemo(() => 
        ['jsx', 'html', 'python', 'python-api', 'javascript'].includes(language), 
        [language]
    );

    const handlePreview = () => {
        if (isPreviewable) {
            onPreview(code, language);
        }
    };
    
    const languageDisplayMap: { [key: string]: string } = {
        jsx: 'React (JSX)',
        html: 'HTML',
        python: 'Python',
        'python-api': 'Python API',
        javascript: 'JavaScript',
    };
    const displayName = languageDisplayMap[language] || language;

    if (!isComplete) {
        return (
            <div className="bg-black/50 rounded-lg my-4 relative border border-border animate-fade-in">
                <div className="flex items-center gap-2 p-3 border-b border-border">
                    <CodeBracketIcon className="w-5 h-5 text-text-tertiary" />
                    <span className="text-sm text-text-secondary">{displayName}</span>
                </div>
                <div className="p-4">
                    <div className="flex items-center space-x-2 animate-pulse-fast">
                        <div className="w-2.5 h-2.5 bg-text-tertiary rounded-full"></div>
                        <div className="w-2.5 h-2.5 bg-text-tertiary rounded-full animation-delay-200"></div>
                        <div className="w-2.5 h-2.5 bg-text-tertiary rounded-full animation-delay-400"></div>
                        <span className="text-sm text-text-tertiary">Generating code...</span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-black/50 rounded-lg my-4 relative border border-border text-sm animate-fade-in">
             <div className="flex items-center justify-between py-1.5 pr-2 pl-4 border-b border-border">
                <span className="text-xs text-text-tertiary font-mono uppercase tracking-wider">{displayName}</span>
                <div className="flex items-center gap-1">
                    {isPreviewable && (
                        <button
                            onClick={handlePreview}
                            className="flex items-center gap-1.5 text-xs text-text-secondary hover:bg-accent-hover hover:text-text-primary transition-colors p-1.5 rounded-md"
                            aria-label="Preview code in sandbox"
                        >
                            <EyeIcon className="w-4 h-4" />
                            Preview
                        </button>
                    )}
                    <button 
                        onClick={handleCopy} 
                        className="flex items-center gap-1.5 text-xs text-text-secondary hover:bg-accent-hover hover:text-text-primary transition-colors p-1.5 rounded-md"
                        aria-label={copied ? "Copied code" : "Copy code"}
                    >
                        {copied ? <CheckIcon className="w-4 h-4 text-green-400" /> : <CopyIcon className="w-4 h-4" />}
                        {copied ? 'Copied' : 'Copy'}
                    </button>
                </div>
            </div>
            <pre className="p-4 overflow-x-auto"><code ref={codeRef} className={`language-${language}`}>{code}</code></pre>
        </div>
    );
};

const MarkdownText: React.FC<{ text: string }> = ({ text }) => {
  const elements: React.ReactNode[] = [];
  const lines = text.split('\n');

  let listItems: React.ReactNode[] = [];
  let currentListType: 'ul' | 'ol' | null = null;
  let listDepth = -1;

  const flushList = () => {
    if (listItems.length > 0) {
      const ListTag = currentListType === 'ol' ? 'ol' : 'ul';
      const listClass = currentListType === 'ol' ? 'list-decimal' : 'list-disc';
      elements.push(<ListTag key={`list-${elements.length}`} className={`${listClass} list-inside space-y-1 my-3 pl-4`}>{listItems}</ListTag>);
      listItems = [];
      currentListType = null;
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
    const ulMatch = line.match(/^(\s*)(\*|-)\s+(.*)/);
    const olMatch = line.match(/^(\s*)(\d+\.)\s+(.*)/);
    const match = ulMatch || olMatch;

    if (match) {
        const newDepth = match[1].length;
        const listType = ulMatch ? 'ul' : 'ol';
        if (listType !== currentListType || newDepth !== listDepth) {
            flushList();
            currentListType = listType;
            listDepth = newDepth;
        }
        listItems.push(<li key={`li-${lineIndex}`}>{applyInlineFormatting(match[3])}</li>);
        return;
    } 
    
    flushList();
    
    if (line.startsWith('# ')) {
      elements.push(<h1 key={lineIndex} className="text-2xl font-bold mt-6 mb-3">{applyInlineFormatting(line.substring(2))}</h1>);
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={lineIndex} className="text-xl font-semibold mt-5 mb-3 border-b border-border pb-2">{applyInlineFormatting(line.substring(3))}</h2>);
    } else if (line.startsWith('### ')) {
      elements.push(<h3 key={lineIndex} className="text-lg font-semibold mt-4 mb-2">{applyInlineFormatting(line.substring(4))}</h3>);
    } else if (line.trim() === '---') {
      elements.push(<hr key={lineIndex} className="border-border my-6" />);
    } else if (line.startsWith('> ')) {
      elements.push(<blockquote key={lineIndex} className="border-l-4 border-border pl-4 my-4 text-text-secondary italic">{applyInlineFormatting(line.substring(2))}</blockquote>);
    } else if (line.trim() !== '') {
      elements.push(<p key={lineIndex}>{applyInlineFormatting(line)}</p>);
    }
  });

  flushList();

  return <div className="space-y-4">{elements}</div>;
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
        <div className="mt-6 border-t border-border pt-4 animate-fade-in">
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
                        className="block bg-surface p-3 rounded-lg hover:bg-accent-hover transition-colors duration-200 group animate-slide-up-and-fade"
                        style={{ animationDelay: `${index * 75}ms`, animationFillMode: 'backwards' }}
                    >
                        <p className="text-text-primary font-medium truncate group-hover:text-accent transition-colors">{cite.title || new URL(cite.uri).hostname}</p>
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
  const isStreaming = (message.status === AIStatus.Generating || message.status === AIStatus.Thinking) && !isUser;
  const displayedText = useTypewriter(message.text, isStreaming && message.status === AIStatus.Generating);

  const content = useMemo(() => {
      const parts = displayedText.split(/(```[\s\S]*?```)/g);
      
      return parts.map((part, index) => {
          const codeMatch = part.match(/```([\w.-]+)?\n?([\s\S]*?)```/);
          if (codeMatch) {
              const language = codeMatch[1] || 'text';
              const code = codeMatch[2] || '';
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
      <div className="w-8 h-8 rounded-full flex items-center justify-center bg-surface text-text-secondary border border-border">
        <UserIcon className="w-5 h-5" />
      </div>
  ) : (
      <div className="w-8 h-8 rounded-full flex items-center justify-center bg-surface text-accent border border-border">
        <SparklesIcon className="w-5 h-5" />
      </div>
  );
  
  const showReasoning = !isUser && (message.reasoning || message.status === AIStatus.Thinking);

  return (
    <div
      data-context-menu-id="chat-message"
      data-message-id={message.id}
      className={`flex items-start gap-4 animate-slide-up-and-fade`}
    >
      <div className="flex-shrink-0 mt-1 animate-scale-in">
        {icon}
      </div>
      <div className="flex-1 pt-0.5 min-w-0">
        <AttachmentsPreview attachments={message.attachments} />
        {isUser && <p className="text-text-primary/95 leading-relaxed whitespace-pre-wrap">{message.text}</p>}
        
        {showReasoning && <ReasoningDisplay reasoning={message.reasoning} status={message.status!} timing={message.timing} />}
        
        {!isUser && (
            <div className="text-text-primary/95 leading-relaxed">
                {content}
                {isStreaming && message.status === AIStatus.Generating && <BlinkingCursor />}
            </div>
        )}

        {!isUser && (
          <>
            <FileDownloads files={message.files} />
            {!isStreaming && message.groundingMetadata && <GroundingCitations metadata={message.groundingMetadata} />}
          </>
        )}
        
        {message.status === AIStatus.Error && (
            <p className="text-red-400 text-sm mt-2 animate-fade-in">An error occurred. Please try again.</p>
        )}
      </div>
    </div>
  );
};
