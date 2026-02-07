
export enum SessionStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
  DISCONNECTED = 'DISCONNECTED'
}

export interface TranscriptionEntry {
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: number;
}

export interface RelayMessage {
  id: string;
  sender: 'hands-free-user' | 'remote-human';
  text: string;
  timestamp: number;
}
