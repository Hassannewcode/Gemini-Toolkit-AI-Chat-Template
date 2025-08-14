export enum Sender {
  User = 'user',
  AI = 'ai',
}

export enum AIStatus {
  Idle = 'idle',
  Thinking = 'thinking',
  Planning = 'planning',
  Searching = 'searching',
  Generating = 'generating',
  Error = 'error',
}

export interface Message {
  id: string;
  sender: Sender;
  text: string;
  timestamp: number;
  status?: AIStatus;
  reasoning?: {
    thought: string;
    critique: string;
    plan: any;
  } | null;
  attachments?: { name: string; type: string; data: string; }[];
  files?: { filename: string; content: string; }[];
  groundingMetadata?: any;
}

export interface Chat {
  id: string;
  title: string;
  messages: Message[];
  sandboxState?: {
    code: string;
    language: string;
  } | null;
}