/// <reference lib="webworker" />
import { generateResponseStream } from './services/geminiService.js';
import { getChat, putChat } from './db.js';
import { AIStatus } from './types.js';

const sw = self;

const broadcastChannel = new BroadcastChannel('gemini-chat-channel');
const abortControllers = new Map();

sw.addEventListener('install', (event) => {
    event.waitUntil(sw.skipWaiting());
});

sw.addEventListener('activate', (event) => {
    event.waitUntil(sw.clients.claim());
});

const broadcastUpdate = (chatId) => {
    broadcastChannel.postMessage({ type: 'UPDATE', chatId });
};

sw.addEventListener('message', (event) => {
    if (event.data.type === 'START_GENERATION') {
        const { chatId, aiMessageId, prompt, history, attachments, isSearchActive } = event.data.payload;
        const controller = new AbortController();
        abortControllers.set(aiMessageId, controller);
        
        handleGeneration(chatId, aiMessageId, prompt, history, attachments, controller.signal, isSearchActive)
            .finally(() => {
                abortControllers.delete(aiMessageId);
            });
    } else if (event.data.type === 'STOP_GENERATION') {
        const { aiMessageId } = event.data.payload;
        const controller = abortControllers.get(aiMessageId);
        if (controller) {
            controller.abort();
            abortControllers.delete(aiMessageId);
        }
    }
});

async function handleGeneration(
    chatId, 
    aiMessageId, 
    prompt, 
    history, 
    attachments, 
    signal,
    isSearchActive
) {
    const reasoningRegex = /<reasoning>([\s\S]*?)<\/reasoning>/;

    try {
        const stream = generateResponseStream(prompt, history, attachments, signal, isSearchActive);
        
        let buffer = '';
        let reasoningData = null;
        let groundingMetadata = null;
        let isReasoningFound = false;
        let currentStatus = AIStatus.Thinking;

        for await (const chunk of stream) {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            
            buffer += chunk.text;
            if (chunk.groundingMetadata) {
                groundingMetadata = chunk.groundingMetadata;
            }

            if (!isReasoningFound) {
                const reasoningMatch = buffer.match(reasoningRegex);
                if (reasoningMatch) {
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
                                } catch(e) { console.error("sw: failed to parse plan json", e); }
                            }
                        }
                        reasoningData = { 
                            step1_analyze_json_input: step1Match ? step1Match[1].trim() : '', 
                            step2_reimagine_and_visualize: step2Match ? step2Match[1].trim() : '',
                            step3_revise_and_plan: step3Match ? step3Match[1].replace(/<plan>[\s\S]*?<\/plan>/, '').trim() : '',
                            plan: plan
                        };
                        isReasoningFound = true;
                    } catch(e) { /* ignore */ }
                    currentStatus = AIStatus.Generating;
                }
            }
            
            const chat = await getChat(chatId);
            if (chat) {
                const messageIndex = chat.messages.findIndex(m => m.id === aiMessageId);
                if (messageIndex > -1) {
                    chat.messages[messageIndex] = {
                        ...chat.messages[messageIndex],
                        text: buffer,
                        reasoning: reasoningData,
                        status: currentStatus,
                        groundingMetadata
                    };
                    await putChat(chat);
                    broadcastUpdate(chatId);
                }
            }
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error("Gemini stream error in SW:", error);
            const chat = await getChat(chatId);
            if (chat) {
                const messageIndex = chat.messages.findIndex(m => m.id === aiMessageId);
                if (messageIndex > -1) {
                    chat.messages[messageIndex].status = AIStatus.Error;
                    chat.messages[messageIndex].text = 'An error occurred in the background. Please try again.';
                }
                await putChat(chat);
                broadcastUpdate(chatId);
            }
        }
    } finally {
        if (signal.aborted) {
             console.log("Stream aborted in SW");
             return;
        }
        const chat = await getChat(chatId);
        if (chat) {
            const messageIndex = chat.messages.findIndex(m => m.id === aiMessageId);
            if (messageIndex > -1) {
                 const aiFinalMessage = chat.messages[messageIndex];
                 const textToParse = aiFinalMessage.text;
                 const reasoningMatch = textToParse.match(reasoningRegex);
                 const finalText = reasoningMatch ? textToParse.replace(reasoningRegex, '').trimStart() : textToParse;
                 aiFinalMessage.text = finalText;
                 aiFinalMessage.status = AIStatus.Idle;

                 const codeMatch = finalText.match(/```(jsx|html|python|python-api|javascript)\n([\s\S]*?)```/);
                 if (codeMatch) {
                   chat.sandboxState = { ...(chat.sandboxState || { consoleOutput: [] }), language: codeMatch[1], code: codeMatch[2] };
                 }
                 
                 const fileCreationRegex = /\{"file":\s*\{"filename":\s*"([^"]+)",\s*"content":\s*"((?:[^"\\]|\\.)*)"\}\}/g;
                 const createdFiles = [];
                 let fileMatch;
                 let newText = finalText;
                 while ((fileMatch = fileCreationRegex.exec(finalText)) !== null) {
                   newText = newText.replace(fileMatch[0], '').trim();
                   try {
                       createdFiles.push({
                         filename: fileMatch[1],
                         content: JSON.parse(`"${fileMatch[2]}"`)
                       });
                   } catch (e) { console.error("sw: Failed to parse file content", e)}
                 }
                 
                 if (createdFiles.length > 0) {
                   aiFinalMessage.files = createdFiles;
                   aiFinalMessage.text = newText;
                 }
                 
                 chat.messages[messageIndex] = aiFinalMessage;
            }
            await putChat(chat);
            broadcastUpdate(chatId);
        }
    }
}
