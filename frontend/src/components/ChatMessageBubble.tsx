import type { ChatMessage } from "@/lib/types";
import { SourceList } from "./SourceList";

export function ChatMessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex w-full min-w-0 ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`flex min-w-0 max-w-[85%] flex-col gap-1 sm:max-w-[75%] ${
          isUser ? "items-end" : "items-start"
        }`}
      >
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm ${
            isUser
              ? "bg-blue-600 text-white rounded-br-sm"
              : message.isError
              ? "bg-red-50 text-red-700 border border-red-200 rounded-bl-sm dark:bg-red-950/40 dark:text-red-300 dark:border-red-900"
              : "bg-white text-zinc-800 border border-zinc-200 rounded-bl-sm dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700"
          }`}
        >
          {message.content}
          {!isUser && !message.isError && message.sources && message.sources.length > 0 && (
            <SourceList sources={message.sources} />
          )}
        </div>
      </div>
    </div>
  );
}
