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
  timing?: { [key: string]: number };
}

export interface Chat {
  id: string;
  title: string;
  messages: Message[];
  sandboxState?: {
    code: string;
    language: string;
    consoleOutput?: { type: string; message: string }[];
  } | null;
}

export type MenuItem =
  | {
      label: string;
      icon?: React.ReactNode;
      action: () => void;
      isSeparator?: false;
      disabled?: boolean;
    }
  | {
      isSeparator: true;
    };
