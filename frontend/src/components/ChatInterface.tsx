"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, DocumentItem } from "@/lib/types";
import { askQuestion, listDocuments, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import { ChatMessageBubble } from "./ChatMessageBubble";
import { TypingIndicator } from "./TypingIndicator";

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function ChatInterface() {
  const { getFreshToken } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [readyDocs, setReadyDocs] = useState<DocumentItem[] | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getFreshToken();
      if (!token || cancelled) return;
      try {
        const docs = await listDocuments(token);
        if (!cancelled) setReadyDocs(docs.filter((d) => d.status === "READY"));
      } catch {
        if (!cancelled) setReadyDocs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getFreshToken, messages.length]);

  async function submitQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed) {
      setValidationError("Please enter a question before sending.");
      return;
    }
    if (isLoading) return;

    setValidationError(null);
    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const token = await getFreshToken();
      if (!token) {
        throw new ApiError("Your session has expired. Please sign in again.");
      }
      const result = await askQuestion(token, trimmed);
      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: "assistant",
          content: result.answer,
          sources: result.sources,
          createdAt: Date.now(),
        },
      ]);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: "assistant",
          content: message,
          isError: true,
          createdAt: Date.now(),
        },
      ]);
    } finally {
      setIsLoading(false);
      textareaRef.current?.focus();
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitQuestion(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitQuestion(input);
    }
  }

  const noReadyDocs = readyDocs !== null && readyDocs.length === 0;
  const suggestions = (readyDocs ?? []).slice(0, 4).map((d) => `What does ${d.fileName} say?`);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {messages.length > 0 && (
        <div className="flex justify-end border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900 sm:px-6">
          <button
            type="button"
            onClick={() => setMessages([])}
            className="rounded-md px-3 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            Clear chat
          </button>
        </div>
      )}

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-6">
        {noReadyDocs && messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <span className="text-3xl" aria-hidden>
              🗂️
            </span>
            <p className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">No ready documents yet</p>
            <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              Upload a PDF or TXT file in the Documents tab and wait for it to finish processing. Once it&apos;s
              marked Ready, you can ask questions about it here.
            </p>
            <a
              href="/dashboard/documents"
              className="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Go to Documents
            </a>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
            <div>
              <p className="text-2xl font-semibold text-zinc-800 dark:text-zinc-100">Ask about your documents</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Answers are grounded only in documents you&apos;ve uploaded, with citations.
              </p>
            </div>
            {suggestions.length > 0 && (
              <div className="grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => submitQuestion(s)}
                    className="min-w-0 [overflow-wrap:anywhere] rounded-lg border border-zinc-200 bg-white px-4 py-3 text-left text-sm text-zinc-700 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-blue-800 dark:hover:bg-blue-950/40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-4">
            {messages.map((message) => (
              <ChatMessageBubble key={message.id} message={message} />
            ))}
            {isLoading && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>
        )}
      </main>

      <footer className="border-t border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900 sm:px-6">
        <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (validationError) setValidationError(null);
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                noReadyDocs ? "Upload and wait for a document to be Ready to start chatting..." : "Ask a question about your documents..."
              }
              rows={1}
              disabled={isLoading}
              aria-label="Ask a question"
              className="max-h-40 flex-1 resize-none rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:ring-blue-900/40"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              aria-label="Send question"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
            >
              {isLoading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-5 w-5"
                >
                  <path d="M2.94 2.94a1.5 1.5 0 011.66-.32l17 8a1.5 1.5 0 010 2.72l-17 8a1.5 1.5 0 01-2.14-1.7L4.5 12 1.46 4.64a1.5 1.5 0 01.48-1.7z" />
                </svg>
              )}
            </button>
          </div>
          {validationError && (
            <p className="text-xs font-medium text-red-600 dark:text-red-400">{validationError}</p>
          )}
          <p className="text-center text-xs text-zinc-400 dark:text-zinc-600">
            Answers can be incomplete. Verify anything important against your source documents.
          </p>
        </form>
      </footer>
    </div>
  );
}
