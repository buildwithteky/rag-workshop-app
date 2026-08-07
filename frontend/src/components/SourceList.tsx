"use client";

import { useState } from "react";
import type { Source } from "@/lib/types";

export function SourceList({ sources }: { sources: Source[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (!sources.length) return null;

  return (
    <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-700">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Sources
      </p>
      <ul className="flex flex-col gap-2">
        {sources.map((source, idx) => (
          <li key={`${source.title}-${idx}`}>
            <button
              type="button"
              onClick={() => setExpanded(expanded === idx ? null : idx)}
              className="flex w-full items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              <span aria-hidden className="text-zinc-400">
                📄
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{source.title}</span>
              <span className="text-zinc-400">{expanded === idx ? "−" : "+"}</span>
            </button>
            {expanded === idx && (
              <p className="mt-1 rounded-md bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
                {source.excerpt}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
