"use client";

import { useEffect, useRef, useState } from "react";
import type { DocumentItem } from "@/lib/types";

/**
 * Lets the user restrict a single conversation's retrieval to a chosen subset of their
 * uploaded documents. This is the UI half of document scoping — the enforcement half
 * lives server-side in the ask Lambda's Bedrock retrieval filter, which reads the
 * documentIds this component saves via onChange rather than trusting anything the client
 * sends at ask-time. An empty selection means "all of my ready documents" (the default,
 * unscoped behavior), which keeps the common case a single click away.
 */
export function DocumentScopePicker({
  documents,
  selectedDocumentIds,
  onChange,
}: {
  documents: DocumentItem[];
  selectedDocumentIds: string[];
  onChange: (documentIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const readyDocs = documents.filter((d) => d.status === "READY");

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggle(documentId: string) {
    const next = selectedDocumentIds.includes(documentId)
      ? selectedDocumentIds.filter((id) => id !== documentId)
      : [...selectedDocumentIds, documentId];
    onChange(next);
  }

  const label =
    selectedDocumentIds.length === 0
      ? "All documents"
      : `${selectedDocumentIds.length} document${selectedDocumentIds.length > 1 ? "s" : ""} selected`;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <span aria-hidden>📎</span> {label}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-72 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <p className="px-2 pb-1.5 pt-1 text-xs text-zinc-400 dark:text-zinc-500">
            Limit this chat to specific documents. Leave nothing checked to search all of your
            ready documents.
          </p>
          {readyDocs.length === 0 ? (
            <p className="px-2 py-2 text-xs text-zinc-400 dark:text-zinc-500">No ready documents yet.</p>
          ) : (
            <ul className="max-h-56 overflow-y-auto">
              {readyDocs.map((doc) => (
                <li key={doc.documentId}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800">
                    <input
                      type="checkbox"
                      checked={selectedDocumentIds.includes(doc.documentId)}
                      onChange={() => toggle(doc.documentId)}
                      className="rounded border-zinc-300 dark:border-zinc-600"
                    />
                    <span className="min-w-0 flex-1 truncate">{doc.fileName}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {selectedDocumentIds.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
            >
              Clear selection (search all documents)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
