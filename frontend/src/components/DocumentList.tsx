"use client";

import { useState } from "react";
import type { DocumentItem, DocumentStatus } from "@/lib/types";

const STATUS_STYLES: Record<DocumentStatus, string> = {
  UPLOADING: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  PROCESSING: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  READY: "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300",
  FAILED: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  DELETING: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const STATUS_LABELS: Record<DocumentStatus, string> = {
  UPLOADING: "Uploading",
  PROCESSING: "Processing",
  READY: "Ready",
  FAILED: "Failed",
  DELETING: "Deleting",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function DocumentList({
  documents,
  onDelete,
  deletingIds,
}: {
  documents: DocumentItem[];
  onDelete: (documentId: string) => void;
  deletingIds: Set<string>;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (documents.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
        <span className="text-3xl" aria-hidden>
          🗂️
        </span>
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">No documents yet</p>
        <p className="max-w-xs text-xs text-zinc-400 dark:text-zinc-500">
          Upload a PDF or TXT file above. Once it finishes processing you can ask questions about it in Chat.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
      {documents.map((doc) => {
        const isDeleting = deletingIds.has(doc.documentId) || doc.status === "DELETING";
        return (
          <li key={doc.documentId} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">{doc.fileName}</p>
              <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                {formatSize(doc.fileSize)} · Uploaded {formatDate(doc.createdAt)}
              </p>
              {doc.status === "FAILED" && doc.errorMessage && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{doc.errorMessage}</p>
              )}
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[doc.status]}`}
            >
              {doc.status === "PROCESSING" && (
                <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              )}
              {STATUS_LABELS[doc.status]}
            </span>
            {confirmId === doc.documentId ? (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    onDelete(doc.documentId);
                    setConfirmId(null);
                  }}
                  className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmId(null)}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setConfirmId(doc.documentId)}
                className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-950/30 dark:hover:text-red-400"
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
