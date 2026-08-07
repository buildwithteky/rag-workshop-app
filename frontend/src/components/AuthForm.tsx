"use client";

import { useState, type FormEvent, type ReactNode } from "react";

export function AuthForm({
  title,
  subtitle,
  children,
  onSubmit,
  submitLabel,
  isSubmitting,
  error,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onSubmit: () => void | Promise<void>;
  submitLabel: string;
  isSubmitting: boolean;
  error: string | null;
  footer?: ReactNode;
}) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-6 text-center">
          <p className="text-2xl" aria-hidden>
            📚
          </p>
          <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {children}
          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex h-11 items-center justify-center rounded-xl bg-blue-600 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
          >
            {isSubmitting ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              submitLabel
            )}
          </button>
        </form>
        {footer && <div className="mt-5 text-center text-sm text-zinc-500 dark:text-zinc-400">{footer}</div>}
      </div>
    </div>
  );
}

export function AuthField({
  label,
  type,
  value,
  onChange,
  autoComplete,
  placeholder,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const resolvedType = type === "password" && showPassword ? "text" : type;

  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      <div className="relative">
        <input
          type={resolvedType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:ring-blue-900/40"
        />
        {type === "password" && (
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        )}
      </div>
    </label>
  );
}
