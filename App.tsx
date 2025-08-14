import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatInput } from './components/ChatInput';
import { ChatMessage } from './components/ChatMessage';
import { WelcomeScreen } from './components/WelcomeScreen';
import { Header } from './components/Header';
import { AIStatus, Message, Sender, Chat, MenuItem } from './types';
import { PreviewPanel } from './components/PreviewPanel';
import { generateResponseStream } from './services/geminiService';
import type { Part } from '@google/genai';
import { ContextMenu } from './components/ContextMenu';
import { BoltIcon, CopyIcon, PencilIcon, PlusIcon, RefreshIcon, ShareIcon, TrashIcon, XMarkIcon } from './components/icons';

const App: React.FC = () => {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [currentAIStatus, setCurrentAIStatus] = useState<AIStatus>(AIStatus.Idle);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const savedChats = localStorage.getItem('chats');
      const savedActiveChatId = localStorage.getItem('activeChatId');
      if (savedChats) {
        setChats(JSON.parse(savedChats));
        if (savedActiveChatId) {
          setActiveChatId(savedActiveChatId);
        }
      }
    } catch (e) {
      console.error("Failed to load from localStorage", e);
      localStorage.clear();
    }
  }, []);

  useEffect(() => {
    try {
      if (chats.length > 0) {
        localStorage.setItem('chats', JSON.stringify(chats));
      } else {
        localStorage.removeItem('chats');
      }
      if (activeChatId) {
        localStorage.setItem('activeChatId', activeChatId);
      } else {
        localStorage.removeItem('activeChatId');
      }
    } catch(e) {
      console.error("Failed to save to localStorage", e);
    }
  }, [chats, activeChatId]);
  
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chats, activeChatId, currentAIStatus]);
  
  const handleStop = useCallback(() => {
    if(abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setCurrentAIStatus(AIStatus.Idle);
    setChats(prev => prev.map(chat => {
        if (chat.id === activeChatId) {
            return {
                ...chat,
                messages: chat.messages.map(msg => msg.status ? { ...msg, status: AIStatus.Idle } : msg)
            };
        }
        return chat;
    }));
  }, [activeChatId]);
  
  const activeChat = chats.find(chat => chat.id === activeChatId);
  
  const setSandboxState = useCallback((state: Chat['sandboxState']) => {
    if (activeChatId) {
        setChats(prev => prev.map(chat => 
            chat.id === activeChatId ? { ...chat, sandboxState: state } : chat
        ));
    }
  }, [activeChatId]);

  const _sendMessage = useCallback(async (
    text: string, 
    attachments: { name: string; type: string; dataUrl: string; base64Data: string; size: number; }[], 
    isSearchActive: boolean,
    isSystemMessage: boolean = false
  ) => {
    if (!text.trim() && attachments.length === 0) return;
    
    handleStop();
    
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      sender: Sender.User,
      text,
      timestamp: Date.now(),
      attachments: attachments.map(f => ({ name: f.name, type: f.type, data: f.dataUrl })),
    };
    
    const aiMessageId = `ai-${Date.now()}`;
    const initialAIMessage: Message = {
      id: aiMessageId,
      sender: Sender.AI,
      text: '',
      timestamp: Date.now(),
      status: AIStatus.Thinking,
      timing: {},
    };
    
    let tempActiveChatId = activeChatId;
    const chatTitle = text.length > 30 ? text.substring(0, 27) + '...' : text || 'New Chat';

    if (!tempActiveChatId) {
        tempActiveChatId = `chat-${Date.now()}`;
        const newChat: Chat = {
            id: tempActiveChatId,
            title: isSystemMessage ? 'Auto-Fix Analysis' : chatTitle,
            messages: [userMessage, initialAIMessage],
        };
        setChats(prev => [newChat, ...prev]);
        setActiveChatId(tempActiveChatId);
    } else {
        setChats(prev => prev.map(chat => 
            chat.id === tempActiveChatId 
                ? { ...chat, messages: [...chat.messages, userMessage, initialAIMessage] } 
                : chat
        ));
    }
    
    setCurrentAIStatus(AIStatus.Thinking);
    
    const currentChat = chats.find(c => c.id === tempActiveChatId) || { messages: [] };
    const history = currentChat.messages.slice(0, -2).map(msg => ({
        role: msg.sender === Sender.User ? 'user' : 'model',
        parts: [{ text: msg.text }]
    }));
    
    const geminiAttachments: Part[] = attachments.map(f => ({
      inlineData: { mimeType: f.type, data: f.base64Data }
    }));

    const promptPayload = {
        query: text,
        files: attachments.map(f => ({ filename: f.name, type: f.type, size: f.size })),
    };
    const promptJson = JSON.stringify(promptPayload, null, 2);

    const reasoningRegex = /<reasoning>([\s\S]*?)<\/reasoning>/;

    const startTime = Date.now();
    let stageTimers = { start: startTime, step1: 0, step2: 0, step3: 0, endReasoning: 0 };
    let timingResults: { [key: string]: number } = {};

    try {
      const stream = generateResponseStream(promptJson, history, geminiAttachments, controller.signal, isSearchActive);
      
      let buffer = '';
      let reasoningData: any = null;
      let groundingMetadata: any = null;
      let isReasoningFound = false;

      for await (const chunk of stream) {
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        
        buffer += chunk.text;
        if (chunk.groundingMetadata) {
            groundingMetadata = chunk.groundingMetadata;
        }

        let currentStatus = AIStatus.Thinking;
        
        if (!isReasoningFound) {
            const now = Date.now();
            if (stageTimers.step1 === 0 && buffer.includes('<step1_analyze_json_input>')) {
                stageTimers.step1 = now;
                timingResults.initialWait = (now - stageTimers.start) / 1000;
            }
            if (stageTimers.step2 === 0 && buffer.includes('<step2_reimagine_and_visualize>')) {
                stageTimers.step2 = now;
                if (stageTimers.step1 > 0) timingResults.step1 = (now - stageTimers.step1) / 1000;
            }
            if (stageTimers.step3 === 0 && buffer.includes('<step3_revise_and_plan>')) {
                stageTimers.step3 = now;
                if (stageTimers.step2 > 0) timingResults.step2 = (now - stageTimers.step2) / 1000;
            }

            const reasoningMatch = buffer.match(reasoningRegex);
            if (reasoningMatch) {
              if (stageTimers.endReasoning === 0) {
                  stageTimers.endReasoning = now;
                  if (stageTimers.step3 > 0) timingResults.step3 = (now - stageTimers.step3) / 1000;
              }
              const reasoningBlock = reasoningMatch[1];
              try {
                const step1Match = reasoningBlock.match(/<step1_analyze_json_input>([\s\S]*?)<\/step1_analyze_json_input>/);
                const step2Match = reasoningBlock.match(/<step2_reimagine_and_visualize>([\s\S]*?)<\/step2_reimagine_and_visualize>/);
                const step3Match = reasoningBlock.match(/<step3_revise_and_plan>([\s\S]*?)<\/step3_revise_and_plan>/);
                
                let plan = null;
                if(step3Match) {
                    const planMatch = step3Match[1].match(/<plan>([\s\S]*?)<\/plan>/);
                    if (planMatch) {
                        try {
                            plan = JSON.parse(planMatch[1].trim());
                        } catch(e) { console.error("failed to parse plan json", e); }
                    }
                }

                reasoningData = { 
                  step1_analyze_json_input: step1Match ? step1Match[1].trim() : '', 
                  step2_reimagine_and_visualize: step2Match ? step2Match[1].trim() : '',
                  step3_revise_and_plan: step3Match ? step3Match[1].replace(/<plan>[\s\S]*?<\/plan>/, '').trim() : '',
                  plan: plan
                };
                isReasoningFound = true;

              } catch (e) { /* ignore parsing errors */ }
              currentStatus = AIStatus.Generating;
              setCurrentAIStatus(AIStatus.Generating);
            }
        }
        
        const textToSet = isReasoningFound ? buffer.replace(reasoningRegex, '').trimStart() : buffer;
        
        setChats(prev => prev.map(chat => {
          if (chat.id === tempActiveChatId) {
            const updatedMessages = chat.messages.map(msg => 
              msg.id === aiMessageId ? { ...msg, text: textToSet, reasoning: reasoningData, status: currentStatus, groundingMetadata, timing: { ...(msg.timing || {}), ...timingResults } } : msg
            );
            return { ...chat, messages: updatedMessages };
          }
          return chat;
        }));
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error("Gemini stream error:", error);
        setChats(prev => prev.map(chat =>
          chat.id === tempActiveChatId ? {
            ...chat,
            messages: chat.messages.map(msg =>
              msg.id === aiMessageId ? { ...msg, status: AIStatus.Error, text: 'An error occurred. Please try again.' } : msg
            )
          } : chat
        ));
      }
    } finally {
        setCurrentAIStatus(AIStatus.Idle);
        abortControllerRef.current = null;
        
        setChats(prev => prev.map(chat => {
            if (chat.id === tempActiveChatId) {
                const finalMessages = chat.messages.map(msg =>
                    msg.id === aiMessageId ? { ...msg, status: AIStatus.Idle } : msg
                );
                
                const aiFinalMessage = finalMessages.find(msg => msg.id === aiMessageId);
                let finalSandboxState = chat.sandboxState;

                if (aiFinalMessage) {
                  const codeMatch = aiFinalMessage.text.match(/```(jsx|html|python|python-api|javascript)\n([\s\S]*?)```/);
                  if (codeMatch) {
                    finalSandboxState = { ...(finalSandboxState || { consoleOutput: [] }), language: codeMatch[1], code: codeMatch[2] };
                  }
                  
                  const fileCreationRegex = /\{"file":\s*\{"filename":\s*"([^"]+)",\s*"content":\s*"((?:[^"\\]|\\.)*)"\}\}/g;
                  const createdFiles: {filename: string, content: string}[] = [];
                  let fileMatch;
                  let newText = aiFinalMessage.text;
                  while ((fileMatch = fileCreationRegex.exec(aiFinalMessage.text)) !== null) {
                    newText = newText.replace(fileMatch[0], '').trim();
                    try {
                        createdFiles.push({
                          filename: fileMatch[1],
                          content: JSON.parse(`"${fileMatch[2]}"`)
                        });
                    } catch (e) { console.error("Failed to parse file content", e)}
                  }
                  
                  if (createdFiles.length > 0) {
                    finalMessages[finalMessages.length - 1] = {
                        ...aiFinalMessage,
                        files: createdFiles,
                        text: newText,
                        status: AIStatus.Idle
                    };
                  }
                }
                return { ...chat, messages: finalMessages, sandboxState: finalSandboxState };
            }
            return chat;
        }));
    }
  }, [activeChatId, chats, handleStop]);
  
  const handleSendMessage = useCallback(async (text: string, files: File[], isSearchActive: boolean) => {
    const filePromises = files.map(file => {
      return new Promise<{ name: string; type: string; dataUrl: string; base64Data: string; size: number; }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          const base64Data = dataUrl.split(',')[1];
          resolve({ name: file.name, type: file.type, dataUrl, base64Data, size: file.size });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    });
    const processedFiles = await Promise.all(filePromises);
    
    _sendMessage(text, processedFiles, isSearchActive, false);
  }, [_sendMessage]);

  const handleAutoFixRequest = useCallback((error: string, code: string, language: string) => {
    const prompt = `The following error was detected in the console:

---
${error}
---

Here is the code that produced it:
\`\`\`${language}
${code}
\`\`\`

Please analyze the error and the code, explain the cause of the error, and provide a corrected version of the code in a new code block.`;
    
    _sendMessage(prompt, [], false, true);
  }, [_sendMessage]);

  const handleAutoFixAllErrorsRequest = useCallback(() => {
    if (!activeChat?.sandboxState) return;
    const { code, language, consoleOutput } = activeChat.sandboxState;
    const errors = consoleOutput?.filter(line => line.type === 'error').map(line => line.message) || [];
    if (errors.length === 0) return;

    const errorText = errors.map((e, i) => `Error ${i+1}:\n${e}`).join('\n\n---\n');
    const prompt = `The following errors were detected in the console:
---
${errorText}
---
Here is the code that produced them:
\`\`\`${language}
${code}
\`\`\`
Please analyze all errors and the code, explain the causes, and provide a single corrected version of the code in a new code block that fixes all identified issues.`;
    
    _sendMessage(prompt, [], false, true);
  }, [activeChat, _sendMessage]);

  const handleNewChat = () => {
    handleStop();
    setActiveChatId(null);
  }

  const handleSelectChat = (id: string) => {
    if (currentAIStatus !== AIStatus.Idle) handleStop();
    setActiveChatId(id);
  }
  
  const handleRenameChat = (id:string, newTitle: string) => {
    setChats(prev => prev.map(chat => chat.id === id ? { ...chat, title: newTitle } : chat));
    setRenamingChatId(null);
  };
  
  const handleDeleteChat = (id: string) => {
    const chatToDelete = chats.find(c => c.id === id);
    if (!chatToDelete) return;
    
    if (window.confirm(`Are you sure you want to delete "${chatToDelete.title}"?`)) {
        setChats(prev => {
            const newChats = prev.filter(chat => chat.id !== id);
            if (activeChatId === id) {
                setActiveChatId(newChats.length > 0 ? newChats[0].id : null);
            }
            return newChats;
        });
    }
  };
  
  const handleShareChat = async (id?: string) => {
    const chatToShare = chats.find(c => c.id === (id || activeChatId));
    if (!chatToShare) return false;
    
    const transcript = chatToShare.messages
      .map(msg => `${msg.sender === 'user' ? 'User' : 'AI'}: ${msg.text}`)
      .join('\n\n');
      
    try {
      await navigator.clipboard.writeText(transcript);
      return true;
    } catch (err) {
      console.error("Failed to copy chat", err);
      return false;
    }
  };
  
  const handlePreviewCode = useCallback((code: string, language: string) => {
    setSandboxState({ code, language, consoleOutput: [] });
  }, [setSandboxState]);

  const handleCodeUpdate = useCallback((newCode: string) => {
    setChats(prevChats => prevChats.map(chat => {
        if (chat.id === activeChatId && chat.sandboxState) {
            return {
                ...chat,
                sandboxState: { ...chat.sandboxState, code: newCode }
            };
        }
        return chat;
    }));
  }, [activeChatId]);

  const handleConsoleUpdate = useCallback((line: { type: string, message: string }) => {
    if (activeChatId) {
        setChats(prev => prev.map(chat => {
            if (chat.id === activeChatId && chat.sandboxState) {
                const newOutput = [...(chat.sandboxState.consoleOutput || []), line];
                return { ...chat, sandboxState: { ...chat.sandboxState, consoleOutput: newOutput }};
            }
            return chat;
        }));
    }
  }, [activeChatId]);

  const handleClearConsole = useCallback(() => {
    if (activeChatId) {
        setChats(prev => prev.map(chat => {
            if (chat.id === activeChatId && chat.sandboxState) {
                return { ...chat, sandboxState: { ...chat.sandboxState, consoleOutput: [] }};
            }
            return chat;
        }));
    }
  }, [activeChatId]);


  const handleCloseContextMenu = useCallback(() => setContextMenu(null), []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    handleCloseContextMenu();
    
    const target = e.target as HTMLElement;
    const menuTarget = target.closest('[data-context-menu-id]');
    const menuId = menuTarget?.getAttribute('data-context-menu-id');
    const items: MenuItem[] = [];

    switch(menuId) {
      case 'sidebar-chat': {
        const chatId = menuTarget!.getAttribute('data-chat-id');
        if (chatId) {
          items.push(
            { label: 'Rename', icon: <PencilIcon className="w-4 h-4"/>, action: () => setRenamingChatId(chatId) },
            { label: 'Share', icon: <ShareIcon className="w-4 h-4" />, action: () => handleShareChat(chatId) },
            { isSeparator: true },
            { label: 'Delete', icon: <TrashIcon className="w-4 h-4" />, action: () => handleDeleteChat(chatId) }
          );
        }
        break;
      }
      case 'chat-message': {
        const msgId = menuTarget!.getAttribute('data-message-id');
        const msg = activeChat?.messages.find(m => m.id === msgId);
        if (msg) {
          items.push({ label: 'Copy Text', icon: <CopyIcon className="w-4 h-4"/>, action: () => navigator.clipboard.writeText(msg.text) });
        }
        break;
      }
      case 'preview-panel': {
        if (activeChat?.sandboxState) {
            const panelElement = document.getElementById('preview-panel-refresh-button');
            items.push(
                { label: 'Refresh Preview', icon: <RefreshIcon className="w-4 h-4" />, action: () => panelElement?.click() },
                { isSeparator: true },
                { label: 'Close Panel', icon: <XMarkIcon className="w-4 h-4" />, action: () => setSandboxState(null) }
            );
        }
        break;
      }
      case 'preview-console': {
        const consoleErrors = activeChat?.sandboxState?.consoleOutput?.filter(line => line.type === 'error') || [];
        if (consoleErrors.length > 0) {
            items.push({
                label: `Fix all ${consoleErrors.length} errors`,
                icon: <BoltIcon className="w-4 h-4" />,
                action: handleAutoFixAllErrorsRequest
            });
        }
        if (activeChat?.sandboxState?.consoleOutput?.length) {
            if (items.length > 0) items.push({ isSeparator: true });
            items.push({
                label: 'Clear Console',
                icon: <TrashIcon className="w-4 h-4" />,
                action: handleClearConsole
            });
        }
        break;
      }
      default: { // Background menu
        items.push({ label: 'New Chat', icon: <PlusIcon className="w-4 h-4"/>, action: handleNewChat });
      }
    }
    
    if (items.length > 0) {
      setContextMenu({ x: e.clientX, y: e.clientY, items });
    }

  }, [activeChat, chats, handleCloseContextMenu, handleNewChat, handleDeleteChat, handleShareChat, handleAutoFixAllErrorsRequest, handleClearConsole]);
  
  const messages = activeChat ? activeChat.messages : [];

  return (
    <div onContextMenu={handleContextMenu} className="flex h-screen w-screen text-text-primary bg-background overflow-hidden">
      <Sidebar 
        chats={chats} 
        activeChatId={activeChatId}
        onNewChat={handleNewChat} 
        onSelectChat={handleSelectChat}
        onRenameChat={handleRenameChat}
        onDeleteChat={handleDeleteChat}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        renamingChatId={renamingChatId}
        onRenameComplete={() => setRenamingChatId(null)}
      />
      <div className="flex flex-1 overflow-hidden relative">
        <div data-context-menu-id="main-chat-area" className={`flex flex-col flex-1 h-screen transition-all duration-300 ease-in-out ${activeChat?.sandboxState ? 'w-full md:w-1/2' : 'w-full'}`}>
          <Header
            onShare={() => handleShareChat()}
            hasActiveChat={!!activeChat}
            onMenuClick={() => setIsSidebarOpen(true)}
          />
          <main className="flex-1 flex flex-col overflow-hidden">
            <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 md:p-6">
               <div className="max-w-3xl mx-auto space-y-8">
                {messages.length === 0 ? (
                  <WelcomeScreen onPromptClick={(prompt) => handleSendMessage(prompt, [], false)} />
                ) : (
                  messages.map(msg => <ChatMessage key={msg.id} message={msg} onPreviewCode={handlePreviewCode} />)
                )}
               </div>
            </div>
            <div className="w-full bg-background/50 backdrop-blur-md">
              <div className="max-w-3xl mx-auto p-4 md:p-6">
                <ChatInput 
                  onSendMessage={handleSendMessage} 
                  onStop={handleStop}
                  isStreaming={currentAIStatus !== AIStatus.Idle && currentAIStatus !== AIStatus.Error}
                />
              </div>
            </div>
          </main>
        </div>
        {activeChat?.sandboxState && (
          <div data-context-menu-id="preview-panel" className="w-full md:w-1/2 animate-slide-in-from-right">
            <PreviewPanel
              key={activeChatId} // Re-mount panel when chat changes
              code={activeChat.sandboxState.code}
              language={activeChat.sandboxState.language}
              consoleOutput={activeChat.sandboxState.consoleOutput || []}
              onClose={() => setSandboxState(null)}
              onCodeUpdate={handleCodeUpdate}
              onAutoFixRequest={handleAutoFixRequest}
              onConsoleUpdate={handleConsoleUpdate}
              onClearConsole={handleClearConsole}
            />
          </div>
        )}
      </div>
      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={handleCloseContextMenu} />}
    </div>
  );
};

export default App;
