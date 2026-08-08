"use client";

import type { Conversation } from "@/lib/types";
import { ConversationList } from "./ConversationList";

/**
 * Desktop-only (hidden below the `md` breakpoint — the mobile equivalent is
 * ConversationHistorySheet). Collapsing to a thin rail instead of unmounting keeps the
 * "New chat" affordance reachable with one click even when collapsed, which matters
 * because starting a new chat is the single most frequent sidebar action.
 */
export function ConversationSidebar({
  collapsed,
  onToggleCollapsed,
  conversations,
  activeConversationId,
  onSelect,
  onNewChat,
  onRename,
  onDelete,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelect: (conversationId: string) => void;
  onNewChat: () => void;
  onRename: (conversationId: string, title: string) => void;
  onDelete: (conversationId: string) => void;
}) {
  if (collapsed) {
    return (
      <div className="hidden w-12 shrink-0 flex-col items-center gap-2 border-r border-zinc-200 bg-white py-3 dark:border-zinc-800 dark:bg-zinc-900 md:flex">
        <button
          type="button"
          aria-label="Expand chat history"
          onClick={onToggleCollapsed}
          className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          »
        </button>
        <button
          type="button"
          aria-label="New chat"
          onClick={onNewChat}
          className="rounded-lg p-2 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
        >
          +
        </button>
      </div>
    );
  }

  return (
    <div className="hidden min-h-0 w-64 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 md:flex">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-3 dark:border-zinc-800">
        <button
          type="button"
          onClick={onNewChat}
          className="flex flex-1 items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <span aria-hidden>+</span> New chat
        </button>
        <button
          type="button"
          aria-label="Collapse chat history"
          onClick={onToggleCollapsed}
          className="shrink-0 rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          «
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <ConversationList
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
