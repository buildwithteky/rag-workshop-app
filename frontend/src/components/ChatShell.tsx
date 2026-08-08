"use client";

import { useCallback, useEffect, useState } from "react";
import type { Conversation, DocumentItem } from "@/lib/types";
import {
  deleteConversation,
  listConversations,
  listDocuments,
  updateConversation,
} from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import { ChatInterface } from "./ChatInterface";
import { ConversationSidebar } from "./ConversationSidebar";
import { ConversationHistorySheet } from "./ConversationHistorySheet";

/**
 * Owns everything the Chat tab needs that outlives a single ChatInterface render: the
 * conversation list (for the sidebar / mobile sheet), which conversation is active, and
 * the user's document library (for the scope picker). ChatInterface itself stays focused
 * on a single conversation's message transcript.
 */
export function ChatShell() {
  const { getFreshToken } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [draftScope, setDraftScope] = useState<string[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [historySheetOpen, setHistorySheetOpen] = useState(false);
  // Deliberately decoupled from activeConversationId: a draft chat being promoted to a
  // real, persisted conversation on its first send (see handleConversationCreated) must
  // NOT remount ChatInterface, or the in-flight question/answer it's mid-way through
  // rendering gets thrown away. Only an explicit "New chat" or sidebar selection should
  // force a fresh instance.
  const [chatInstanceKey, setChatInstanceKey] = useState("draft");

  const refreshConversations = useCallback(async () => {
    const token = await getFreshToken();
    if (!token) return;
    try {
      const list = await listConversations(token);
      setConversations(list);
    } catch {
      // Non-fatal: the active chat still works, it just won't show up in the sidebar
      // until the next successful refresh.
    }
  }, [getFreshToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getFreshToken();
      if (!token || cancelled) return;
      const [convos, docs] = await Promise.all([
        listConversations(token).catch(() => []),
        listDocuments(token).catch(() => []),
      ]);
      if (cancelled) return;
      setConversations(convos);
      setDocuments(docs);
      if (convos.length > 0) {
        setActiveConversationId(convos[0].conversationId);
        setChatInstanceKey(convos[0].conversationId);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Documents are also polled while any are still PROCESSING, so a newly-ready document
  // shows up in the scope picker without requiring a manual tab switch.
  useEffect(() => {
    if (!documents.some((d) => d.status === "PROCESSING" || d.status === "UPLOADING")) return;
    const interval = setInterval(async () => {
      const token = await getFreshToken();
      if (!token) return;
      try {
        setDocuments(await listDocuments(token));
      } catch {
        // Ignore transient polling failures; the next tick retries.
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [documents, getFreshToken]);

  const activeConversation = conversations.find((c) => c.conversationId === activeConversationId) ?? null;

  function handleNewChat() {
    setActiveConversationId(null);
    setDraftScope([]);
    setChatInstanceKey(`draft-${Date.now()}`);
  }

  function handleSelect(conversationId: string) {
    setActiveConversationId(conversationId);
    setChatInstanceKey(conversationId);
  }

  function handleConversationCreated(conversation: Conversation) {
    setConversations((prev) => [conversation, ...prev]);
    setActiveConversationId(conversation.conversationId);
    // Note: chatInstanceKey deliberately NOT updated here — see its declaration above.
  }

  async function handleRename(conversationId: string, title: string) {
    setConversations((prev) =>
      prev.map((c) => (c.conversationId === conversationId ? { ...c, title } : c))
    );
    const token = await getFreshToken();
    if (!token) return;
    try {
      await updateConversation(token, conversationId, { title });
    } catch {
      refreshConversations();
    }
  }

  async function handleDelete(conversationId: string) {
    setConversations((prev) => prev.filter((c) => c.conversationId !== conversationId));
    if (activeConversationId === conversationId) handleNewChat();
    const token = await getFreshToken();
    if (!token) return;
    try {
      await deleteConversation(token, conversationId);
    } catch {
      refreshConversations();
    }
  }

  async function handleScopeChange(documentIds: string[]) {
    if (!activeConversationId) {
      setDraftScope(documentIds);
      return;
    }
    setConversations((prev) =>
      prev.map((c) => (c.conversationId === activeConversationId ? { ...c, documentIds } : c))
    );
    const token = await getFreshToken();
    if (!token) return;
    try {
      await updateConversation(token, activeConversationId, { documentIds });
    } catch {
      refreshConversations();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <ConversationSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelect={handleSelect}
        onNewChat={handleNewChat}
        onRename={handleRename}
        onDelete={handleDelete}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900 md:hidden">
          <button
            type="button"
            onClick={() => setHistorySheetOpen(true)}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
          >
            ☰ History
          </button>
          <button
            type="button"
            onClick={handleNewChat}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            + New chat
          </button>
        </div>

        <ChatInterface
          key={chatInstanceKey}
          conversationId={activeConversationId}
          conversation={activeConversation}
          documents={documents}
          draftScope={draftScope}
          onScopeChange={handleScopeChange}
          onConversationCreated={handleConversationCreated}
          onConversationActivity={refreshConversations}
        />
      </div>

      <ConversationHistorySheet
        open={historySheetOpen}
        onClose={() => setHistorySheetOpen(false)}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelect={handleSelect}
        onNewChat={handleNewChat}
        onRename={handleRename}
        onDelete={handleDelete}
      />
    </div>
  );
}
