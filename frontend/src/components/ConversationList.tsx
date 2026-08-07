"use client";

import { useState } from "react";
import type { Conversation } from "@/lib/types";

function formatRelative(epochSeconds: number): string {
  const diffMs = Date.now() - epochSeconds * 1000;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(epochSeconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Renders the conversation list itself — the part shared between the desktop sidebar and
 * the mobile bottom sheet. Keeping selection/rename/delete behavior in one place means
 * both surfaces stay behaviorally identical; only their container (fixed panel vs. sheet)
 * differs.
 */
export function ConversationList({
  conversations,
  activeConversationId,
  onSelect,
  onRename,
  onDelete,
}: {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelect: (conversationId: string) => void;
  onRename: (conversationId: string, title: string) => void;
  onDelete: (conversationId: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function startEditing(conversation: Conversation) {
    setEditingId(conversation.conversationId);
    setDraftTitle(conversation.title);
  }

  function commitEditing(conversationId: string) {
    const trimmed = draftTitle.trim();
    if (trimmed) onRename(conversationId, trimmed);
    setEditingId(null);
  }

  if (conversations.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
        No conversations yet. Start a new chat to begin.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {conversations.map((conversation) => {
        const isActive = conversation.conversationId === activeConversationId;
        const isEditing = editingId === conversation.conversationId;
        const isConfirmingDelete = confirmDeleteId === conversation.conversationId;

        return (
          <li key={conversation.conversationId}>
            {isEditing ? (
              <input
                autoFocus
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={() => commitEditing(conversation.conversationId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEditing(conversation.conversationId);
                  if (e.key === "Escape") setEditingId(null);
                }}
                className="w-full rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm text-zinc-800 focus:outline-none dark:border-blue-800 dark:bg-zinc-800 dark:text-zinc-100"
              />
            ) : (
              <div
                className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors ${
                  isActive
                    ? "bg-blue-50 dark:bg-blue-950/50"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(conversation.conversationId)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p
                    className={`truncate text-sm font-medium ${
                      isActive ? "text-blue-700 dark:text-blue-300" : "text-zinc-700 dark:text-zinc-200"
                    }`}
                  >
                    {conversation.title || "New chat"}
                  </p>
                  <p className="truncate text-xs text-zinc-400 dark:text-zinc-500">
                    {formatRelative(conversation.updatedAt)}
                    {conversation.documentIds.length > 0 && ` · ${conversation.documentIds.length} doc scoped`}
                  </p>
                </button>

                {isConfirmingDelete ? (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        onDelete(conversation.conversationId);
                        setConfirmDeleteId(null);
                      }}
                      className="rounded px-1.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded px-1.5 py-1 text-xs text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                    <button
                      type="button"
                      aria-label="Rename conversation"
                      onClick={() => startEditing(conversation)}
                      className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      aria-label="Delete conversation"
                      onClick={() => setConfirmDeleteId(conversation.conversationId)}
                      className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                    >
                      🗑
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
