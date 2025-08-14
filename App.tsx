import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatInput } from './components/ChatInput';
import { ChatMessage } from './components/ChatMessage';
import { WelcomeScreen } from './components/WelcomeScreen';
import { Header } from './components/Header';
import { AIStatus, Message, Sender, Chat } from './types';
import { PreviewPanel } from './components/PreviewPanel';
import { generateResponseStream } from './services/geminiService';

const App: React.FC = () => {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [currentAIStatus, setCurrentAIStatus] = useState<AIStatus>(AIStatus.Idle);
  const [sandboxState, setSandboxState] = useState<{ code: string; language: string; } | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedChats = localStorage.getItem('chats');
    if (savedChats) {
      setChats(JSON.parse(savedChats));
    }
  }, []);

  useEffect(() => {
    if (chats.length > 0) {
      localStorage.setItem('chats', JSON.stringify(chats));
    }
  }, [chats]);
  
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chats, activeChatId, sandboxState]); // Rerun on sandbox state change to ensure scroll
  
  const handleStop = useCallback(() => {
    if(abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const handleSendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;
    
    handleStop();
    setSandboxState(null);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      sender: Sender.User,
      text,
      timestamp: Date.now(),
    };
    
    const aiMessageId = `ai-${Date.now()}`;
    const initialAIMessage: Message = {
      id: aiMessageId,
      sender: Sender.AI,
      text: '',
      timestamp: Date.now(),
      status: AIStatus.Thinking,
    };
    
    let tempActiveChatId = activeChatId;

    if (!tempActiveChatId) {
        tempActiveChatId = `chat-${Date.now()}`;
        const newChat: Chat = {
            id: tempActiveChatId,
            title: text.length > 30 ? text.substring(0, 27) + '...' : text,
            messages: [userMessage, initialAIMessage]
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
    
    const activeChatForHistory = chats.find(c => c.id === tempActiveChatId) ?? { messages: [] };
    const history = (activeChatForHistory.messages.slice(0, -2) ?? []).map(msg => ({
      role: msg.sender === Sender.User ? 'user' : 'model',
      parts: [{ text: msg.text }]
    }));

    try {
      const stream = generateResponseStream(text, history, controller.signal);
      let firstChunk = true;

      for await (const chunkText of stream) {
        if (controller.signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }
        if (firstChunk) {
            setCurrentAIStatus(AIStatus.Generating);
            firstChunk = false;
        }
        setChats(prev => prev.map(chat => {
          if (chat.id === tempActiveChatId) {
            const updatedMessages = chat.messages.map(msg => 
              msg.id === aiMessageId ? { ...msg, text: msg.text + chunkText } : msg
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
            const finalChats = prev.map(chat => {
                if (chat.id === tempActiveChatId) {
                    const finalMessages = chat.messages.map(msg =>
                        msg.id === aiMessageId ? { ...msg, status: AIStatus.Idle } : msg
                    );
                    
                    const aiFinalMessage = finalMessages.find(msg => msg.id === aiMessageId);
                    if (aiFinalMessage) {
                      const codeMatch = aiFinalMessage.text.match(/```(jsx|html|python|python-api)\n([\s\S]*?)```/);
                      if (codeMatch) {
                        const language = codeMatch[1];
                        const code = codeMatch[2];
                        // Defer state update to avoid issues with React's render cycle
                        setTimeout(() => setSandboxState({ code, language }), 0);
                      }
                    }

                    return { ...chat, messages: finalMessages };
                }
                return chat;
            });
            return finalChats;
        });
    }
  }, [activeChatId, chats, handleStop]);
  
  const handleNewChat = () => {
    handleStop();
    setActiveChatId(null);
    setSandboxState(null);
  }

  const handleSelectChat = (id: string) => {
    handleStop();
    setActiveChatId(id);
    setSandboxState(null);
  }

  const activeChat = chats.find(chat => chat.id === activeChatId);
  const messages = activeChat ? activeChat.messages : [];

  return (
    <div className="flex h-screen w-screen text-text-primary bg-background">
      <Sidebar 
        chats={chats} 
        activeChatId={activeChatId}
        onNewChat={handleNewChat} 
        onSelectChat={handleSelectChat}
      />
      <div className="flex flex-1 overflow-hidden">
        <div className={`flex flex-col flex-1 h-screen transition-all duration-300 ease-in-out ${sandboxState ? 'w-1/2' : 'w-full'}`}>
          <Header />
          <main className="flex-1 flex flex-col overflow-hidden">
            <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 md:p-6">
               <div className="max-w-3xl mx-auto space-y-8">
                {messages.length === 0 ? (
                  <WelcomeScreen onPromptClick={(prompt) => handleSendMessage(prompt)} />
                ) : (
                  messages.map(msg => <ChatMessage key={msg.id} message={msg} />)
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
            onClose={() => setSandboxState(null)}
          />
        )}
      </div>
    </div>
  );
};

export default App;