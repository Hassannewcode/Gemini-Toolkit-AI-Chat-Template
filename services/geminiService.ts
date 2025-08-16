import { GoogleGenAI, Content, Part } from "@google/genai";
import { ModelType } from '../types';
import { unrestrainedSystemInstructionText } from './unrestrainedPrompt';

const ai = new GoogleGenAI({apiKey: process.env.API_KEY!});

const systemInstructionText = `You are a world-class AI developer.
Your goal is to help the user build applications.

When the user asks you to code:
1.  **First, explain your plan.** Describe what you will create in simple terms.
2.  **Then, write the code.** You MUST provide all file contents using the \`json:files\` tool.

The \`json:files\` tool uses a JSON array inside a markdown code block:
\`\`\`json:files
[
  {
    "operation": "create", // or "update", "delete"
    "path": "path/to/file.html",
    "content": "File content here. Use \\n for newlines."
  }
]
\`\`\`

Example user request: "Create a hello world webpage"

Your response should look like this:

I will create a simple \`index.html\` file to display "Hello, World!".

\`\`\`json:files
[
  {
    "operation": "create",
    "path": "index.html",
    "content": "<!DOCTYPE html>\\n<html>\\n<head><title>Hello</title></head>\\n<body><h1>Hello, World!</h1></body>\\n</html>"
  }
]
\`\`\`

The sandbox can run HTML/CSS/JS, Node.js, and Python backends. Frontend \`fetch\` requests to relative paths are automatically proxied to your backend server.

Now, begin.`;

const systemInstructions = {
    'gemini': systemInstructionText,
    'unrestrained': unrestrainedSystemInstructionText
};


export async function* generateResponseStream(
    prompt: string, 
    history: Content[], 
    attachments: Part[], 
    signal: AbortSignal,
    isSearchActive: boolean,
    modelType: ModelType
): AsyncGenerator<{ text: string, groundingMetadata?: any }, void, undefined> {
    const model = 'gemini-2.5-flash';
    
    const systemInstruction = systemInstructions[modelType] || systemInstructions['gemini'];
    
    const chat = ai.chats.create({
        model,
        history: history,
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.8,
          topP: 0.95,
          topK: 64, // Increased topK for more nuanced responses
          ...(isSearchActive && { tools: [{ googleSearch: {} }] }),
        }
    });

    const userParts: Part[] = [{ text: prompt }, ...attachments];

    try {
        const result = await chat.sendMessageStream({ message: userParts });
        
        for await (const chunk of result) {
            if (signal.aborted) {
                console.log("Stream aborted");
                return;
            }
            yield { 
                text: chunk.text, 
                groundingMetadata: chunk.candidates?.[0]?.groundingMetadata 
            };
        }
    } catch (error) {
        console.error("Error in generateResponseStream:", error);
        throw error;
    }
}