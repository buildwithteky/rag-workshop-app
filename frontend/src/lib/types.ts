export interface Source {
  title: string;
  excerpt: string;
}

export interface AskResponse {
  answer: string;
  sources: Source[];
  sessionId?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  isError?: boolean;
  createdAt: number;
}

export type DocumentStatus = "UPLOADING" | "PROCESSING" | "READY" | "FAILED" | "DELETING";

export interface DocumentItem {
  documentId: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  status: DocumentStatus;
  errorMessage?: string | null;
  createdAt: number;
  updatedAt: number;
}
