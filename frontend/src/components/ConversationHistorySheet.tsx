"use client";

import type { Conversation } from "@/lib/types";
import { ConversationList } from "./ConversationList";

/**
 * Mobile equivalent of ConversationSidebar (shown only below `md`). A backdrop + slide-up
 * panel rather than a permanent rail, because on a phone screen a persistent sidebar would
 * eat the chat itself. The list area has a capped max-height with its own scroll container
 * (`overflow-y-auto`) so it scrolls internally as conversation count grows, instead of
 * pushing "New chat" or the close affordance off-screen.
 */
export function ConversationHistorySheet({
  open,
  onClose,
  conversations,
  activeConversationId,
  onSelect,
  onNewChat,
  onRename,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelect: (conversationId: string) => void;
  onNewChat: () => void;
  onRename: (conversationId: string, title: string) => void;
  onDelete: (conversationId: string) => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end md:hidden">
      <button
        type="button"
        aria-label="Close chat history"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div className="relative flex max-h-[75vh] flex-col rounded-t-2xl border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-700" />
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Chat history</h2>
          <button
            type="button"
            onClick={() => {
              onNewChat();
              onClose();
            }}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            + New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          <ConversationList
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelect={(id) => {
              onSelect(id);
              onClose();
            }}
            onRename={onRename}
            onDelete={onDelete}
          />
        </div>
      </div>
    </div>
  );
}
