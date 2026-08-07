"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DashboardShell } from "@/components/DashboardShell";
import { DocumentUploader } from "@/components/DocumentUploader";
import { DocumentList } from "@/components/DocumentList";
import { listDocuments, deleteDocument, ApiError } from "@/lib/api";
import type { DocumentItem } from "@/lib/types";

const POLL_INTERVAL_MS = 4000;

function DocumentsPageContent() {
  const { getFreshToken } = useAuth();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const token = await getFreshToken();
      if (!token) {
        setError("Your session has expired. Please sign in again.");
        return;
      }
      const docs = await listDocuments(token);
      setDocuments(docs);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load documents.");
    } finally {
      setIsLoading(false);
    }
  }, [getFreshToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const hasInFlight = documents.some((d) => d.status === "UPLOADING" || d.status === "PROCESSING");
    if (hasInFlight && !pollRef.current) {
      pollRef.current = setInterval(refresh, POLL_INTERVAL_MS);
    } else if (!hasInFlight && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [documents, refresh]);

  async function handleDelete(documentId: string) {
    setDeletingIds((prev) => new Set(prev).add(documentId));
    try {
      const token = await getFreshToken();
      if (!token) {
        setError("Your session has expired. Please sign in again.");
        return;
      }
      await deleteDocument(token, documentId);
      setDocuments((prev) => prev.filter((d) => d.documentId !== documentId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete document. Please try again.");
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(documentId);
        return next;
      });
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 overflow-y-auto px-4 py-6 sm:px-6">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Documents</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Upload PDF or TXT files. They&apos;ll be searchable in Chat once processing finishes.
        </p>
      </div>

      <DocumentUploader onUploaded={refresh} />

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {isLoading ? (
        <div className="flex justify-center py-10">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600" />
        </div>
      ) : (
        <DocumentList documents={documents} onDelete={handleDelete} deletingIds={deletingIds} />
      )}
    </main>
  );
}

export default function DocumentsPage() {
  return (
    <ProtectedRoute>
      <DashboardShell>
        <DocumentsPageContent />
      </DashboardShell>
    </ProtectedRoute>
  );
}
