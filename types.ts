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
  plan?: any;
  attachments?: { name: string; type: string; data: string; }[];
  files?: { filename: string; content: string; }[];
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
