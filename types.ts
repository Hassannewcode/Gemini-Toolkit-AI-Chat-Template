export enum Sender {
  User = 'user',
  AI = 'ai',
}

export enum AIStatus {
  Idle = 'idle',
  Thinking = 'thinking',
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
}

export interface Chat {
  id: string;
  title: string;
  messages: Message[];
}
