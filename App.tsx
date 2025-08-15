

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatInput } from './components/ChatInput';
import { ChatMessage } from './components/ChatMessage';
import { WelcomeScreen } from './components/WelcomeScreen';
import { Header } from './components/Header';
import { AIStatus, Message, Sender, Chat, MenuItem, SandboxFile, ModelType } from './types';
import { Sandbox } from './components/PreviewPanel';
import { generateResponseStream } from './services/geminiService';
import type { Part, Content } from '@google/genai';
import { ContextMenu } from './components/ContextMenu';
import { BoltIcon, CopyIcon, PencilIcon, PlusIcon, RefreshIcon, ShareIcon, TrashIcon, XMarkIcon } from './components/icons';
import { ErrorAnalysisBanner } from './components/ErrorAnalysisBanner';

const App: React.FC = () => {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [currentAIStatus, setCurrentAIStatus] = useState<AIStatus>(AIStatus.Idle);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState<ModelType>('gemini');

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
  
  const setSandboxState = useCallback((state: Chat['sandboxState'] | null) => {
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
    
    const tempActiveChatId = activeChatId || `chat-${Date.now()}`;
    let history: Content[];
    let modelForThisMessage: ModelType;

    if (!activeChatId) {
        const chatTitle = text.length > 30 ? text.substring(0, 27) + '...' : text || 'New Chat';
        const newChat: Chat = {
            id: tempActiveChatId,
            title: isSystemMessage ? 'System Command' : chatTitle,
            messages: [userMessage, initialAIMessage],
            model: currentModel,
        };
        history = [];
        modelForThisMessage = currentModel;
        setChats(prev => [newChat, ...prev]);
        setActiveChatId(tempActiveChatId);
    } else {
        const currentChat = chats.find(c => c.id === activeChatId)!;
        modelForThisMessage = currentChat.model || 'gemini';
        history = currentChat.messages.map(msg => ({
            role: msg.sender === Sender.User ? 'user' : 'model',
            parts: [{ text: msg.text }]
        }));
        setChats(prev => prev.map(chat => 
            chat.id === activeChatId 
                ? { ...chat, messages: [...chat.messages, userMessage, initialAIMessage] } 
                : chat
        ));
    }
    
    setCurrentAIStatus(AIStatus.Thinking);
    
    const geminiAttachments: Part[] = attachments.map(f => ({
      inlineData: { mimeType: f.type, data: f.base64Data }
    }));

    const promptPayload = {
        query: text,
        files: attachments.map(f => ({ filename: f.name, type: f.type, size: f.size })),
        sandbox: activeChat?.sandboxState
    };
    const promptJson = JSON.stringify(promptPayload, null, 2);

    const reasoningRegex = /<reasoning>([\s\S]*?)<\/reasoning>/;

    const startTime = Date.now();
    let stageTimers = { start: startTime, step1: 0, step2: 0, step3: 0, endReasoning: 0 };
    let timingResults: { [key: string]: number } = {};

    try {
      const stream = generateResponseStream(promptJson, history, geminiAttachments, controller.signal, isSearchActive, modelForThisMessage);
      
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
                const finalMessages = [...chat.messages];
                const aiFinalMessageIndex = finalMessages.findIndex(msg => msg.id === aiMessageId);
                if (aiFinalMessageIndex === -1) return chat;

                const aiFinalMessage = finalMessages[aiFinalMessageIndex];
                let finalSandboxState = chat.sandboxState;
                let newText = aiFinalMessage?.text || '';

                if (aiFinalMessage) {
                  // Handle filesystem operations
                  const filesJsonMatch = newText.match(/```json:files\n([\s\S]*?)```/);
                  if (filesJsonMatch) {
                    newText = newText.replace(filesJsonMatch[0], '').trim();
                    try {
                        const operations = JSON.parse(filesJsonMatch[1]);
                        let sandbox = finalSandboxState || { files: {}, openFiles: [], activeFile: null, consoleOutput: [] };
                        let lastPath: string | null = null;
                        operations.forEach((op: {operation: string, path: string, content?: string}) => {
                           switch(op.operation) {
                               case 'create':
                               case 'update':
                                   const lang = op.path.split('.').pop() || 'text';
                                   sandbox.files[op.path] = { code: op.content || '', language: lang };
                                   if (!sandbox.openFiles.includes(op.path)) sandbox.openFiles.push(op.path);
                                   lastPath = op.path;
                                   break;
                               case 'delete':
                                   delete sandbox.files[op.path];
                                   sandbox.openFiles = sandbox.openFiles.filter(p => p !== op.path);
                                   if (sandbox.activeFile === op.path) sandbox.activeFile = null;
                                   break;
                           }
                        });
                        if (lastPath) sandbox.activeFile = lastPath;
                        if (!sandbox.activeFile && sandbox.openFiles.length > 0) {
                            sandbox.activeFile = sandbox.openFiles[0];
                        }
                        finalSandboxState = sandbox;

                    } catch(e) { console.error("Failed to parse filesystem JSON", e); }
                  } else {
                    // Fallback to old single code block logic
                    const codeMatch = newText.match(/```(jsx|html|python|python-api|javascript)\n([\s\S]*?)```/);
                    if (codeMatch && !finalSandboxState) { // Only create if sandbox doesn't exist
                       const language = codeMatch[1];
                       const code = codeMatch[2];
                       const filename = `main.${language === 'jsx' ? 'jsx' : language}`;
                       finalSandboxState = {
                         files: { [filename]: { code, language } },
                         openFiles: [filename],
                         activeFile: filename,
                         consoleOutput: []
                       };
                    }
                  }
                  
                  // This is for legacy file creation, should be phased out.
                  const fileCreationRegex = /\{"file":\s*\{"filename":\s*"([^"]+)",\s*"content":\s*"((?:[^"\\]|\\.)*)"\}\}/g;
                  let fileMatch;
                  while ((fileMatch = fileCreationRegex.exec(aiFinalMessage.text)) !== null) {
                    newText = newText.replace(fileMatch[0], '').trim();
                  }
                  
                  finalMessages[aiFinalMessageIndex] = {
                      ...aiFinalMessage,
                      text: newText,
                      status: AIStatus.Idle
                  };
                }
                
                // If the user's message was a system command and the AI's response is empty, remove both
                if (isSystemMessage && !finalMessages[aiFinalMessageIndex].text.trim()) {
                    const userMessageIndex = finalMessages.findIndex(m => m.id === userMessage.id);
                    finalMessages.splice(aiFinalMessageIndex, 1);
                    if (userMessageIndex !== -1) {
                       finalMessages.splice(userMessageIndex, 1);
                    }
                }

                return { ...chat, messages: finalMessages, sandboxState: finalSandboxState };
            }
            return chat;
        }));
    }
  }, [activeChatId, chats, handleStop, activeChat, currentModel]);
  
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
  
  const handleOpenInSandbox = useCallback((code: string, language: string) => {
    if (!activeChatId) return;

    setChats(prevChats => prevChats.map(chat => {
      if (chat.id === activeChatId) {
        const sandbox = chat.sandboxState || { files: {}, openFiles: [], activeFile: null, consoleOutput: [] };
        
        let filename = `component.${language}`;
        let i = 1;
        while (sandbox.files[filename]) {
          filename = `component_${i++}.${language}`;
        }

        sandbox.files[filename] = { code, language };
        if (!sandbox.openFiles.includes(filename)) {
          sandbox.openFiles = [...sandbox.openFiles, filename];
        }
        sandbox.activeFile = filename;
        
        return { ...chat, sandboxState: sandbox };
      }
      return chat;
    }));
  }, [activeChatId]);


  const handleAutoFixRequest = useCallback((error: string) => {
    if (!activeChat?.sandboxState?.files) return;
    const { files } = activeChat.sandboxState;

    const filesText = Object.entries(files).map(([path, file]) => {
        return `File: \`${path}\`
\`\`\`${file.language || path.split('.').pop()}
${file.code}
\`\`\``;
    }).join('\n\n');

    const prompt = `The following error was detected in the console:
---
${error}
---
Here are all the files in the current project sandbox:
---
${filesText}
---
Please analyze this specific error in the context of the entire project, explain its cause, and provide a corrected version of the relevant file(s) by using file system operations to update them in the sandbox. Focus only on fixing this single error.`;
    
    _sendMessage(prompt, [], false, true);
  }, [activeChat, _sendMessage]);

  const handleAutoFixAllErrorsRequest = useCallback(() => {
    if (!activeChat?.sandboxState) return;
    const { files, consoleOutput } = activeChat.sandboxState;
    if (!files || Object.keys(files).length === 0) return;

    const errors = consoleOutput?.filter(line => line.type === 'error').map(line => line.message) || [];
    if (errors.length === 0) return;

    const errorText = errors.map((e, i) => `Error ${i+1}:\n${e}`).join('\n\n---\n');
    
    const filesText = Object.entries(files).map(([path, file]) => {
        return `File: \`${path}\`
\`\`\`${file.language || path.split('.').pop()}
${file.code}
\`\`\``;
    }).join('\n\n');

    const prompt = `The following errors were detected in the console:
---
${errorText}
---
Here are all the files in the current project sandbox:
---
${filesText}
---
Please analyze all errors in the context of the entire project, explain the causes, and provide corrected versions of any necessary files by using file system operations to update them in the sandbox.`;
    
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
  
  const handleSandboxUpdate = useCallback((updater: (prevState: Chat['sandboxState']) => Chat['sandboxState']) => {
    if (activeChatId) {
      setChats(prev => prev.map(chat =>
        chat.id === activeChatId && chat.sandboxState
          ? { ...chat, sandboxState: updater(chat.sandboxState) as any }
          : chat
      ));
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
            { label: 'Rename', icon: <PencilIcon className="w-4 h-4"/>, action: () => setRenamingChatId(chatId), isSeparator: false },
            { label: 'Share', icon: <ShareIcon className="w-4 h-4" />, action: () => handleShareChat(chatId), isSeparator: false },
            { isSeparator: true },
            { label: 'Delete', icon: <TrashIcon className="w-4 h-4" />, action: () => handleDeleteChat(chatId), isSeparator: false }
          );
        }
        break;
      }
      case 'chat-message': {
        const msgId = menuTarget!.getAttribute('data-message-id');
        const msg = activeChat?.messages.find(m => m.id === msgId);
        if (msg) {
          items.push({ label: 'Copy Text', icon: <CopyIcon className="w-4 h-4"/>, action: () => navigator.clipboard.writeText(msg.text), isSeparator: false });
        }
        break;
      }
      case 'sandbox-file': {
        const path = menuTarget!.getAttribute('data-path')!;
        items.push({
            label: 'Delete File',
            icon: <TrashIcon className="w-4 h-4" />,
            action: () => handleSandboxUpdate(prev => {
                const newFiles = { ...prev!.files };
                delete newFiles[path];
                const newOpenFiles = prev!.openFiles.filter(p => p !== path);
                const newActiveFile = prev!.activeFile === path ? (newOpenFiles[0] || null) : prev!.activeFile;
                return { ...prev!, files: newFiles, openFiles: newOpenFiles, activeFile: newActiveFile };
            }),
            isSeparator: false,
        });
        break;
      }
      case 'preview-console': {
        const consoleErrors = activeChat?.sandboxState?.consoleOutput?.filter(line => line.type === 'error') || [];
        if (consoleErrors.length > 0) {
            items.push({
                label: `Fix all ${consoleErrors.length} errors`,
                icon: <BoltIcon className="w-4 h-4" />,
                action: handleAutoFixAllErrorsRequest,
                isSeparator: false,
            });
        }
        if (activeChat?.sandboxState?.consoleOutput?.length) {
            if (items.length > 0) items.push({ isSeparator: true });
            items.push({
                label: 'Clear Console',
                icon: <TrashIcon className="w-4 h-4" />,
                action: () => handleSandboxUpdate(p => ({ ...p!, consoleOutput: [] })),
                isSeparator: false,
            });
        }
        break;
      }
      default: { // Background menu
        items.push({ label: 'New Chat', icon: <PlusIcon className="w-4 h-4"/>, action: handleNewChat, isSeparator: false });
      }
    }
    
    if (items.length > 0) {
      setContextMenu({ x: e.clientX, y: e.clientY, items });
    }

  }, [activeChat, chats, handleCloseContextMenu, handleNewChat, handleDeleteChat, handleShareChat, handleAutoFixAllErrorsRequest, handleSandboxUpdate]);
  
  const messages = activeChat ? activeChat.messages : [];

  const handleModelChange = (model: ModelType) => {
    setCurrentModel(model);
    if (activeChat) {
      setChats(prev => prev.map(chat => 
        chat.id === activeChatId ? { ...chat, model: model } : chat
      ));
    }
  };

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
        <div data-context-menu-id="main-chat-area" className={`flex flex-col flex-1 h-screen transition-all duration-300 ease-in-out ${activeChat?.sandboxState ? 'w-full md:w-2/5 lg:w-1/3' : 'w-full'}`}>
          <Header
            onShare={() => handleShareChat()}
            hasActiveChat={!!activeChat}
            onMenuClick={() => setIsSidebarOpen(true)}
            activeChatModel={activeChat?.model}
            currentModel={currentModel}
            onModelChange={handleModelChange}
            isStreaming={currentAIStatus !== AIStatus.Idle && currentAIStatus !== AIStatus.Error}
          />
          <main className="flex-1 flex flex-col overflow-hidden">
            <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 md:p-6">
               <div className="max-w-3xl mx-auto space-y-8">
                {messages.length === 0 ? (
                  <WelcomeScreen onPromptClick={(prompt) => handleSendMessage(prompt, [], false)} />
                ) : (
                  messages.map(msg => <ChatMessage key={msg.id} message={msg} onOpenInSandbox={handleOpenInSandbox} />)
                )}
               </div>
            </div>
            <div className="w-full bg-background/50 backdrop-blur-md">
              <div className="max-w-3xl mx-auto p-4 md:p-6">
                {activeChat?.sandboxState?.consoleOutput?.some(l => l.type === 'error') && (
                  <div className="mb-4">
                    <ErrorAnalysisBanner
                        consoleOutput={activeChat.sandboxState.consoleOutput}
                        onFixRequest={handleAutoFixAllErrorsRequest}
                    />
                  </div>
                )}
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
          <div className="w-full absolute top-0 right-0 h-full md:relative md:w-3/5 lg:w-2/3 animate-slide-in-from-right">
            <Sandbox
              key={activeChatId} // Re-mount panel when chat changes
              sandboxState={activeChat.sandboxState}
              onClose={() => setSandboxState(null)}
              onUpdate={handleSandboxUpdate}
              onAutoFixRequest={handleAutoFixRequest}
            />
          </div>
        )}
      </div>
      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={handleCloseContextMenu} />}
    </div>
  );
};

export default App;