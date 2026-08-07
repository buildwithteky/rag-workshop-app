import type { AskResponse, DocumentItem } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

async function authedFetch(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<Response> {
  if (!API_URL) {
    throw new ApiError("The app is not configured with an API endpoint. Set NEXT_PUBLIC_API_URL.");
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    throw new ApiError("Could not reach the server. Check your connection and try again.");
  }
  if (res.status === 401) {
    throw new ApiError("Your session has expired. Please sign in again.", 401);
  }
  return res;
}

async function parseJsonOrThrow(res: Response): Promise<unknown> {
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ApiError("Received an unexpected response from the server.");
  }
  if (!res.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: unknown }).error)
        : "Something went wrong. Please try again.";
    throw new ApiError(message, res.status);
  }
  return data;
}

export async function askQuestion(token: string, question: string): Promise<AskResponse> {
  const res = await authedFetch("/chat", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  return parseJsonOrThrow(res) as Promise<AskResponse>;
}

export async function listDocuments(token: string): Promise<DocumentItem[]> {
  const res = await authedFetch("/documents", token, { method: "GET" });
  const data = (await parseJsonOrThrow(res)) as { documents: DocumentItem[] };
  return data.documents;
}

export async function getDocumentStatus(token: string, documentId: string): Promise<DocumentItem> {
  const res = await authedFetch(`/documents/${documentId}/status`, token, { method: "GET" });
  return parseJsonOrThrow(res) as Promise<DocumentItem>;
}

export async function deleteDocument(token: string, documentId: string): Promise<void> {
  const res = await authedFetch(`/documents/${documentId}`, token, { method: "DELETE" });
  await parseJsonOrThrow(res);
}

export interface UploadUrlResponse {
  documentId: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

export async function requestUploadUrl(
  token: string,
  fileName: string,
  contentType: string,
  fileSize: number
): Promise<UploadUrlResponse> {
  const res = await authedFetch("/documents/upload", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, contentType, fileSize }),
  });
  return parseJsonOrThrow(res) as Promise<UploadUrlResponse>;
}

export function uploadFileToPresignedUrl(
  uploadUrl: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiError("File upload failed. Please try again."));
    };
    xhr.onerror = () => reject(new ApiError("File upload failed. Check your connection and try again."));
    xhr.send(file);
  });
}
