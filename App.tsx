import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatInput } from './components/ChatInput';
import { ChatMessage } from './components/ChatMessage';
import { WelcomeScreen } from './components/WelcomeScreen';
import { Header } from './components/Header';
import { AIStatus, Message, Sender, Chat } from './types';
import { PreviewPanel } from './components/PreviewPanel';
import { generateResponseStream } from './services/geminiService';
import type { Part } from '@google/genai';

declare var JSZip: any;

const App: React.FC = () => {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [currentAIStatus, setCurrentAIStatus] = useState<AIStatus>(AIStatus.Idle);
  const [sandboxState, setSandboxState] = useState<{ code: string; language: string; } | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const savedChats = localStorage.getItem('chats');
      const savedActiveChatId = localStorage.getItem('activeChatId');
      if (savedChats) {
        const parsedChats: Chat[] = JSON.parse(savedChats);
        setChats(parsedChats);
        
        const activeChat = parsedChats.find(c => c.id === savedActiveChatId);
        if (activeChat) {
          setActiveChatId(activeChat.id);
          if (activeChat.sandboxState) {
            setSandboxState(activeChat.sandboxState);
          }
        }
      }
    } catch (e) {
      console.error("Failed to load from localStorage", e);
      localStorage.clear(); // Clear corrupted storage
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
  }, [chats, activeChatId]);
  
  const handleStop = useCallback(() => {
    if(abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setCurrentAIStatus(AIStatus.Idle);
  }, []);
  
  const setAndPersistSandboxState = useCallback((state: { code: string; language: string; } | null) => {
    setSandboxState(state);
    if (activeChatId) {
        setChats(prev => prev.map(chat => 
            chat.id === activeChatId ? { ...chat, sandboxState: state } : chat
        ));
    }
  }, [activeChatId]);

  const handleSendMessage = useCallback(async (text: string, files: File[], isSearchActive: boolean) => {
    if (!text.trim() && files.length === 0) return;
    
    handleStop();
    
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const expandedFiles: File[] = [];
    for (const file of files) {
        if ((file.type === 'application/zip' || file.type === 'application/x-zip-compressed' || file.name.endsWith('.zip')) && typeof JSZip !== 'undefined') {
            try {
                const zip = await JSZip.loadAsync(file);
                for (const filename in zip.files) {
                    if (!zip.files[filename].dir) {
                        const zipFile = zip.files[filename];
                        const blob = await zipFile.async('blob');
                        
                        const getMimeType = (name: string): string => {
                          const ext = name.split('.').pop()?.toLowerCase() || '';
                          const mimeTypes: { [key: string]: string } = {
                            // Text
                            'txt': 'text/plain', 'html': 'text/html', 'css': 'text/css', 'js': 'application/javascript',
                            'json': 'application/json', 'xml': 'application/xml', 'md': 'text/markdown',
                            // Images
                            'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif', 'svg': 'image/svg+xml', 'webp': 'image/webp',
                            // Documents
                            'pdf': 'application/pdf',
                            'doc': 'application/msword',
                            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                            'xls': 'application/vnd.ms-excel',
                            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                            'ppt': 'application/vnd.ms-powerpoint',
                            'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                            // Archives
                            'zip': 'application/zip',
                            // Others
                            'csv': 'text/csv',
                          };
                          return mimeTypes[ext] || 'application/octet-stream';
                        }

                        const newFile = new File([blob], `${file.name}/${filename}`, { type: getMimeType(filename) });
                        expandedFiles.push(newFile);
                    }
                }
            } catch (e) {
                console.error("Failed to process zip file", e);
                expandedFiles.push(file); // Push original file if zip processing fails
            }
        } else {
            expandedFiles.push(file);
        }
    }
    
    const filePromises = expandedFiles.map(file => {
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

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      sender: Sender.User,
      text,
      timestamp: Date.now(),
      attachments: processedFiles.map(f => ({ name: f.name, type: f.type, data: f.dataUrl })),
    };
    
    const aiMessageId = `ai-${Date.now()}`;
    const initialAIMessage: Message = {
      id: aiMessageId,
      sender: Sender.AI,
      text: '',
      timestamp: Date.now(),
      status: AIStatus.Thinking,
      reasoning: null,
      groundingMetadata: null,
    };
    
    let tempActiveChatId = activeChatId;
    let isNewChat = false;

    if (!tempActiveChatId) {
        isNewChat = true;
        tempActiveChatId = `chat-${Date.now()}`;
        const newChat: Chat = {
            id: tempActiveChatId,
            title: text.length > 30 ? text.substring(0, 27) + '...' : text || 'New Chat',
            messages: [userMessage, initialAIMessage],
            sandboxState: null,
        };
        setChats(prev => [newChat, ...prev]);
        setActiveChatId(tempActiveChatId);
        setAndPersistSandboxState(null);
    } else {
        setChats(prev => prev.map(chat => 
            chat.id === tempActiveChatId 
                ? { ...chat, messages: [...chat.messages, userMessage, initialAIMessage] } 
                : chat
        ));
    }
    
    setCurrentAIStatus(AIStatus.Thinking);
    
    const getHistory = (chatId: string) => {
      const chat = chats.find(c => c.id === chatId);
      return (chat?.messages.slice(0, -2) ?? []).map(msg => ({
        role: msg.sender === Sender.User ? 'user' : 'model',
        parts: [{ text: msg.text }] // Note: This simplified history does not include attachments from past messages.
      }));
    };
    
    const history = isNewChat ? [] : getHistory(tempActiveChatId);
    
    const geminiAttachments: Part[] = processedFiles.map(f => ({
      inlineData: { mimeType: f.type, data: f.base64Data }
    }));

    const promptPayload = {
        query: text,
        files: processedFiles.map(f => ({ filename: f.name, type: f.type, size: f.size })),
    };
    const promptJson = JSON.stringify(promptPayload, null, 2);

    try {
      const stream = generateResponseStream(promptJson, history, geminiAttachments, controller.signal, isSearchActive);
      
      let reasoningData: any = null;
      let buffer = '';
      let isReasoningFound = false;
      let groundingMetadata: any = null;

      for await (const chunk of stream) {
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        
        buffer += chunk.text;
        
        if (chunk.groundingMetadata) {
            groundingMetadata = chunk.groundingMetadata;
        }

        let currentStatus = currentAIStatus;
        let textToSet = buffer;

        if (!isReasoningFound) {
            const reasoningRegex = /<reasoning>([\s\S]*?)<\/reasoning>/;
            const reasoningMatch = buffer.match(reasoningRegex);
          
            if (reasoningMatch) {
              const reasoningBlock = reasoningMatch[1];
              try {
                const thoughtMatch = reasoningBlock.match(/<thought>([\s\S]*?)<\/thought>/);
                const critiqueMatch = reasoningBlock.match(/<critique>([\s\S]*?)<\/critique>/);
                const planMatch = reasoningBlock.match(/<plan>([\s\S]*?)<\/plan>/);

                const thought = thoughtMatch ? thoughtMatch[1].trim() : '';
                const critique = critiqueMatch ? critiqueMatch[1].trim() : '';
                const plan = planMatch ? JSON.parse(planMatch[1].trim()) : null;
                
                reasoningData = { thought, critique, plan };
                isReasoningFound = true;
                currentStatus = AIStatus.Generating;
                textToSet = buffer.replace(reasoningRegex, '').trimStart();
                setCurrentAIStatus(AIStatus.Generating);
              } catch (e) {
                console.error("Failed to parse reasoning block", e);
                isReasoningFound = true; // Stop trying
                setCurrentAIStatus(AIStatus.Generating);
                textToSet = buffer.replace(reasoningRegex, '').trimStart(); // Still remove the block
              }
            } else if (buffer.length > 1000 && !buffer.includes('<reasoning>')) { // Failsafe
                isReasoningFound = true;
                setCurrentAIStatus(AIStatus.Generating);
            }
        }
        
        setChats(prev => prev.map(chat => {
          if (chat.id === tempActiveChatId) {
            const updatedMessages = chat.messages.map(msg => 
              msg.id === aiMessageId ? { 
                ...msg, 
                text: textToSet, 
                reasoning: reasoningData ?? msg.reasoning, 
                status: currentStatus,
                groundingMetadata: groundingMetadata ?? msg.groundingMetadata,
              } : msg
            );
            return { ...chat, messages: updatedMessages };
          }
          return chat;
        }));
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
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
        
        setChats(prev => {
            return prev.map(chat => {
                if (chat.id === tempActiveChatId) {
                    let finalMessages = chat.messages.map(msg =>
                        msg.id === aiMessageId ? { ...msg, status: AIStatus.Idle } : msg
                    );
                    
                    const aiFinalMessage = finalMessages.find(msg => msg.id === aiMessageId);
                    if (aiFinalMessage) {
                      // Handle code blocks for sandbox
                      const codeMatch = aiFinalMessage.text.match(/```(jsx|html|python|python-api)\n([\s\S]*?)```/);
                      const sandboxState = codeMatch ? { language: codeMatch[1], code: codeMatch[2] } : chat.sandboxState;
                      
                      // Handle file creation
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
                        finalMessages = finalMessages.map(msg =>
                          msg.id === aiMessageId ? { ...msg, files: createdFiles, text: newText } : msg
                        );
                      }
                      
                      if (sandboxState !== chat.sandboxState) {
                         setTimeout(() => setAndPersistSandboxState(sandboxState), 0);
                      }
                      return { ...chat, messages: finalMessages, sandboxState };
                    }
                    return { ...chat, messages: finalMessages };
                }
                return chat;
            });
        });
    }
  }, [activeChatId, chats, handleStop, setAndPersistSandboxState]);
  
  const handleNewChat = () => {
    handleStop();
    setActiveChatId(null);
    setAndPersistSandboxState(null);
  }

  const handleSelectChat = (id: string) => {
    if (currentAIStatus !== AIStatus.Idle) handleStop();
    setActiveChatId(id);
    const selectedChat = chats.find(chat => chat.id === id);
    setSandboxState(selectedChat?.sandboxState || null);
  }
  
  const handleRenameChat = (id: string, newTitle: string) => {
    setChats(prev => prev.map(chat => chat.id === id ? { ...chat, title: newTitle } : chat));
  };
  
  const handleDeleteChat = (id: string) => {
    const chatToDelete = chats.find(c => c.id === id);
    if (!chatToDelete) return;
    
    if (window.confirm(`Are you sure you want to delete "${chatToDelete.title}"?`)) {
        setChats(prev => {
            const newChats = prev.filter(chat => chat.id !== id);
            if (activeChatId === id) {
                const newActiveId = newChats.length > 0 ? newChats[0].id : null;
                setActiveChatId(newActiveId);
                if (newActiveId) {
                    const newActiveChat = newChats.find(c => c.id === newActiveId);
                    setSandboxState(newActiveChat?.sandboxState || null);
                } else {
                    setSandboxState(null);
                }
            }
            return newChats;
        });
    }
  };
  
  const handleShareChat = async () => {
    const chat = activeChat;
    if (!chat) return false;
    
    const transcript = chat.messages
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
    setAndPersistSandboxState({ code, language });
  }, [setAndPersistSandboxState]);

  const handleCodeUpdate = useCallback((newCode: string) => {
    if (sandboxState) {
      setAndPersistSandboxState({ ...sandboxState, code: newCode });
    }
  }, [sandboxState, setAndPersistSandboxState]);

  const activeChat = chats.find(chat => chat.id === activeChatId);
  const messages = activeChat ? activeChat.messages : [];

  return (
    <div className="flex h-screen w-screen text-text-primary bg-background overflow-hidden">
      <Sidebar 
        chats={chats} 
        activeChatId={activeChatId}
        onNewChat={handleNewChat} 
        onSelectChat={handleSelectChat}
        onRenameChat={handleRenameChat}
        onDeleteChat={handleDeleteChat}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />
      <div className="flex flex-1 overflow-hidden relative">
        <div className={`flex flex-col flex-1 h-screen transition-all duration-300 ease-in-out ${sandboxState ? 'hidden md:flex md:w-1/2' : 'flex w-full'}`}>
          <Header
            onShare={handleShareChat}
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
        {sandboxState && (
          <PreviewPanel
            key={activeChatId} // Re-mount panel when chat changes
            code={sandboxState.code}
            language={sandboxState.language}
            onClose={() => setAndPersistSandboxState(null)}
            onCodeUpdate={handleCodeUpdate}
          />
        )}
      </div>
    </div>
  );
};

export default App;