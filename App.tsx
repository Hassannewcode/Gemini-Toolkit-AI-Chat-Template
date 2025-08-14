import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatInput } from './components/ChatInput';
import { ChatMessage } from './components/ChatMessage';
import { WelcomeScreen } from './components/WelcomeScreen';
import { Header } from './components/Header';
import { AIStatus, Message, Sender, Chat, MenuItem } from './types';
import { PreviewPanel } from './components/PreviewPanel';
import type { Part } from '@google/genai';
import { ContextMenu } from './components/ContextMenu';
import { BoltIcon, CopyIcon, PencilIcon, PlusIcon, RefreshIcon, ShareIcon, TrashIcon, XMarkIcon } from './components/icons';
import { getAllChats, putChat, deleteChat, getChat } from './db';

const App: React.FC = () => {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);

  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Register Service Worker
    const registerServiceWorker = () => {
      if ('serviceWorker' in navigator) {
        // Construct a full URL to the service worker using the page's origin to prevent cross-origin registration errors
        // that can occur in sandboxed environments like iframes.
        const swUrl = `${window.location.origin}/service-worker.js`;
        navigator.serviceWorker.register(swUrl, { type: 'module' }).then(
            (registration) => {
                console.log('Service Worker registration successful with scope: ', registration.scope);
            },
            (err) => {
                console.log('Service Worker registration failed: ', err);
            },
        );
      }
    };

    // Defer registration until after the page has fully loaded to avoid "invalid state" errors.
    if (document.readyState === 'complete') {
        registerServiceWorker();
    } else {
        window.addEventListener('load', registerServiceWorker);
    }

    // Load initial data from DB
    const loadData = async () => {
        const dbChats = await getAllChats();
        dbChats.sort((a, b) => {
            const lastMessageA = a.messages[a.messages.length - 1];
            const lastMessageB = b.messages[b.messages.length - 1];
            return (lastMessageB?.timestamp || 0) - (lastMessageA?.timestamp || 0);
        });
        setChats(dbChats);
        
        if (dbChats.length > 0) {
            const lastActive = localStorage.getItem('activeChatId');
            if (lastActive && dbChats.some(c => c.id === lastActive)) {
                setActiveChatId(lastActive);
            } else {
                setActiveChatId(dbChats[0].id);
            }
        }
    };
    loadData();

    // Listen for updates from Service Worker
    const channel = new BroadcastChannel('gemini-chat-channel');
    const handleChannelMessage = async (event: MessageEvent) => {
        if (event.data.type === 'UPDATE') {
            const { chatId } = event.data;
            const updatedChat = await getChat(chatId);
            if (updatedChat) {
                setChats(prevChats => {
                    const index = prevChats.findIndex(c => c.id === chatId);
                    if (index > -1) {
                        const newChats = [...prevChats];
                        newChats[index] = updatedChat;
                        return newChats;
                    }
                    return [updatedChat, ...prevChats].sort((a, b) => {
                        const lastMessageA = a.messages[a.messages.length - 1];
                        const lastMessageB = b.messages[b.messages.length - 1];
                        return (lastMessageB?.timestamp || 0) - (lastMessageA?.timestamp || 0);
                    });
                });
            }
        }
    };
    channel.addEventListener('message', handleChannelMessage);

    return () => {
        window.removeEventListener('load', registerServiceWorker);
        channel.removeEventListener('message', handleChannelMessage);
        channel.close();
    };
  }, []);

  useEffect(() => {
    if (activeChatId) {
        localStorage.setItem('activeChatId', activeChatId);
    } else {
        localStorage.removeItem('activeChatId');
    }
  }, [activeChatId]);
  
  const activeChat = chats.find(chat => chat.id === activeChatId);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [activeChat?.messages.length, activeChat?.messages[activeChat.messages.length - 1]?.text.length]);
  
  const lastMessage = activeChat?.messages[activeChat.messages.length - 1];
  const currentAIStatus = (lastMessage?.sender === Sender.AI && lastMessage.status) ? lastMessage.status : AIStatus.Idle;
  const isStreaming = currentAIStatus !== AIStatus.Idle && currentAIStatus !== AIStatus.Error;

  const handleStop = useCallback(() => {
    const lastAiMessage = activeChat?.messages.slice().reverse().find(m => m.sender === Sender.AI);
    if (lastAiMessage && lastAiMessage.status && lastAiMessage.status !== AIStatus.Idle && activeChat) {
      navigator.serviceWorker.controller?.postMessage({
        type: 'STOP_GENERATION',
        payload: {
            aiMessageId: lastAiMessage.id
        }
      });
      // Optimistic update
      const updatedChat = {
          ...activeChat,
          messages: activeChat.messages.map(msg => msg.id === lastAiMessage.id ? { ...msg, status: AIStatus.Idle } : msg)
      };
      putChat(updatedChat);
      setChats(prev => prev.map(c => c.id === activeChat.id ? updatedChat : c));
    }
  }, [activeChat]);
  
  const setSandboxState = useCallback(async (state: Chat['sandboxState']) => {
    if (activeChatId) {
      const chat = await getChat(activeChatId);
      if (chat) {
        const updatedChat = { ...chat, sandboxState: state };
        await putChat(updatedChat);
        setChats(prev => prev.map(c => c.id === activeChatId ? updatedChat : c));
      }
    }
  }, [activeChatId]);

  const _sendMessage = useCallback(async (
    text: string, 
    attachments: { name: string; type: string; dataUrl: string; base64Data: string; size: number; }[], 
    isSearchActive: boolean,
    isSystemMessage: boolean = false
  ) => {
    if ((!text.trim() && attachments.length === 0) || !navigator.serviceWorker.controller) {
        if (!navigator.serviceWorker.controller) {
            console.error("Service worker not ready, please wait a moment and try again.");
            // Optionally show a toast notification to the user
        }
        return;
    }
    
    handleStop();

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
    let newChat: Chat | null = null;
    const chatTitle = text.length > 30 ? text.substring(0, 27) + '...' : text || 'New Chat';

    if (!tempActiveChatId) {
        tempActiveChatId = `chat-${Date.now()}`;
        newChat = {
            id: tempActiveChatId,
            title: isSystemMessage ? 'Auto-Fix Analysis' : chatTitle,
            messages: [userMessage, initialAIMessage],
        };
        setActiveChatId(tempActiveChatId);
    } 

    const finalMessages = newChat ? newChat.messages : [...(activeChat?.messages || []), userMessage, initialAIMessage];
    const chatToSave = newChat || { ...activeChat!, messages: finalMessages };
    
    setChats(prev => {
        if (newChat) return [newChat, ...prev];
        return prev.map(c => c.id === tempActiveChatId ? chatToSave : c);
    });

    await putChat(chatToSave);
    
    const history = finalMessages.slice(0, -2).map(msg => ({
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
    
    navigator.serviceWorker.controller.postMessage({
        type: 'START_GENERATION',
        payload: {
            chatId: tempActiveChatId,
            aiMessageId,
            prompt: promptJson,
            history,
            attachments: geminiAttachments,
            isSearchActive
        }
    });

  }, [activeChatId, activeChat, handleStop]);
  
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
    if (isStreaming) handleStop();
    setActiveChatId(id);
  }
  
  const handleRenameChat = async (id:string, newTitle: string) => {
    const chatToRename = chats.find(c => c.id === id);
    if (chatToRename) {
        const updatedChat = { ...chatToRename, title: newTitle };
        await putChat(updatedChat);
        setChats(prev => prev.map(chat => chat.id === id ? updatedChat : chat));
    }
    setRenamingChatId(null);
  };
  
  const handleDeleteChat = async (id: string) => {
    const chatToDelete = chats.find(c => c.id === id);
    if (!chatToDelete) return;
    
    if (window.confirm(`Are you sure you want to delete "${chatToDelete.title}"?`)) {
        await deleteChat(id);
        const newChats = chats.filter(chat => chat.id !== id);
        setChats(newChats);
        if (activeChatId === id) {
            setActiveChatId(newChats.length > 0 ? newChats[0].id : null);
        }
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

  const handleCodeUpdate = useCallback(async (newCode: string) => {
    const chat = await getChat(activeChatId!);
    if (chat && chat.sandboxState) {
        const updatedChat = {
            ...chat,
            sandboxState: { ...chat.sandboxState, code: newCode }
        };
        await putChat(updatedChat);
        setChats(prev => prev.map(c => c.id === activeChatId ? updatedChat : c));
    }
  }, [activeChatId]);

  const handleConsoleUpdate = useCallback(async (line: { type: string, message: string }) => {
    if (activeChatId) {
        const chat = await getChat(activeChatId);
        if (chat && chat.sandboxState) {
            const newOutput = [...(chat.sandboxState.consoleOutput || []), line];
            const updatedChat = { ...chat, sandboxState: { ...chat.sandboxState, consoleOutput: newOutput }};
            await putChat(updatedChat);
            setChats(prev => prev.map(c => c.id === activeChatId ? updatedChat : c));
        }
    }
  }, [activeChatId]);

  const handleClearConsole = useCallback(async () => {
    if (activeChatId) {
        const chat = await getChat(activeChatId);
        if (chat && chat.sandboxState) {
            const updatedChat = { ...chat, sandboxState: { ...chat.sandboxState, consoleOutput: [] }};
            await putChat(updatedChat);
            setChats(prev => prev.map(c => c.id === activeChatId ? updatedChat : c));
        }
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
                  isStreaming={isStreaming}
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