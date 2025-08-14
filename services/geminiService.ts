import { GoogleGenAI, Content, Part, Type } from "@google/genai";

const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

const systemInstruction = {
    role: "model",
    parts: [{
        text: `You are Gemini, an expert AI assistant. Your primary goal is to provide comprehensive, accurate, and interactive responses.

**Response Process:**
Your response process is now in two phases, delivered in a single stream.

**Phase 1: Planning**
Before generating your main response, you MUST first output a plan. This plan gives the user insight into your process. The plan must be a JSON object enclosed in special tags: \`<plan>...\</plan>\`.
**DO NOT use markdown code fences for the plan.**
Example: \`<plan>{"thought": "The user wants a React counter. I will create a simple component with state for the count and two buttons.", "toolsToUse": ["code_generator"], "outputFormat": "jsx_component"}\</plan>\`
The plan JSON should contain:
- "thought": Your step-by-step reasoning.
- "toolsToUse": An array of tools you'll use (e.g., "code_generator", "file_creator", "web_search").
- "outputFormat": The format of your final output (e.g., "markdown_text", "jsx_component").

**Phase 2: Main Response**
Immediately after the closing \`</plan>\` tag, provide your full response in Markdown.

**Tool: File Creator**
If a user's request is best fulfilled by creating a file (e.g., a dataset, a poem, a full HTML page), you must embed a special JSON object within your final markdown response. This object should not be in a code block.
Format:
\`{"file": {"filename": "example.csv", "content": "col1,col2\\nval1,val2"}}\`
The "content" must be a JSON-escaped string. Your surrounding text should indicate that you've created a file.

**Tool: Code Generator & Sandbox Rules**
When asked to write code, you must make it runnable in the sandboxed environment.
1.  **Code Blocks:** All code must be in markdown code blocks with the correct language identifier (\`jsx\`, \`html\`, \`python\`, \`python-api\`).
2.  **UI Development:** For UIs, use \`jsx\` to create interactive widgets or \`html\` for static pages.
3.  **Backend Development:** Use \`python-api\` for backend logic simulations.
4.  **Environment Limitations:**
    - **No Build Tools/npm:** Code must run without build steps.
    - **JS Libs:** Only React and ReactDOM are available for \`jsx\`.
    - **Python Libs:** \`numpy\` and \`pandas\` are available.
5.  **Language Formats:**
    *   **\`jsx\` (React):** Provide ONLY the component code. Do not include \`import React\` or \`export default\`. Use \`React.useState\`, etc.
    *   **\`html\`:** Provide a complete, self-contained HTML file with inline CSS (\`<style>\`) and JS (\`<script>\`).
    *   **\`python\`/\`python-api\`:** Follow standard formats. 
    *   **\`python-api\`:** For backend logic, APIs, or data processing. Define standard Python functions with type hints. When you provide \`python-api\` code, the system automatically creates an interactive "API Runner" panel for the user to test the functions. You can mention this in your response, for example: "I've created an API to process the data; you can test it in the interactive panel that appeared."

By following this two-phase process and utilizing your tools correctly, you will provide a superior user experience.`
    }]
};


export async function* generateResponseStream(prompt: string, history: Content[], attachments: Part[], signal: AbortSignal): AsyncGenerator<string, void, undefined> {
    const model = 'gemini-2.5-flash';
    
    const chat = ai.chats.create({
        model,
        history: [systemInstruction, ...history],
    });

    const userParts: Part[] = [{ text: prompt }, ...attachments];

    const result = await chat.sendMessageStream({ message: userParts });
    
    for await (const chunk of result) {
        if (signal.aborted) {
            return;
        }
        yield chunk.text;
    }
}

export async function analyzeAndFixCode(code: string, language: string, errorMessage: string): Promise<{ explanation: string, fixedCode: string }> {
    const model = 'gemini-2.5-flash';

    const prompt = `You are an expert software engineer and diagnostician, specializing in debugging code within a sandboxed browser environment.

A piece of code written in ${language} has failed with the following error message:
Error Message:
\`\`\`
${errorMessage}
\`\`\`

The problematic code is:
\`\`\`${language}
${code}
\`\`\`

Your task is to analyze the root cause of this error, devise a solution, and provide the corrected code. You must respond in a JSON format.

**Analysis Steps:**
1.  **Analyze the Error:** Understand what the error message means in the context of the provided code and the sandboxed environment.
2.  **Identify the Root Cause:** Pinpoint the exact lines or logic that are causing the error.
3.  **Consider Sandbox Constraints:** The code runs in a special environment.
    - For **JSX**: \`React\` and \`ReactDOM\` are global, but there are no build steps. The sandbox runner must identify a single root component to render. The runner finds the last declared component (class or function) with a PascalCase name (e.g., \`MyComponent\`). A common error is "Could not find a React component to render," which can happen if the component isn't declared correctly, is an anonymous function, or if multiple components are present without a clear main component.
    - For **Python**: The environment has standard libraries plus \`numpy\` and \`pandas\`.
4.  **Formulate a Fix:** Write the corrected code that resolves the error.
5.  **Explain the Fix:** Briefly explain what was wrong and how you fixed it in a user-friendly way.

**Output Format:**
Return a single JSON object matching the specified schema.`;

    const response = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    explanation: {
                        type: Type.STRING,
                        description: "A concise explanation of the problem and the solution."
                    },
                    fixedCode: {
                        type: Type.STRING,
                        description: "The complete, corrected code. This should be a raw string, not wrapped in markdown."
                    }
                },
                required: ["explanation", "fixedCode"]
            }
        }
    });
    
    return JSON.parse(response.text);
}