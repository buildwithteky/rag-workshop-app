"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { requestUploadUrl, uploadFileToPresignedUrl, ApiError } from "@/lib/api";

const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "text/plain": "TXT",
};
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

export function DocumentUploader({ onUploaded }: { onUploaded: () => void }) {
  const { getFreshToken } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  async function startUpload(file: File) {
    setError(null);

    if (!ALLOWED_TYPES[file.type]) {
      setError("Only PDF and TXT files are supported.");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError("File exceeds the 10 MB size limit.");
      return;
    }
    if (file.size === 0) {
      setError("This file is empty.");
      return;
    }

    setProgress(0);
    try {
      const token = await getFreshToken();
      if (!token) {
        setError("Your session has expired. Please sign in again.");
        return;
      }
      const { uploadUrl } = await requestUploadUrl(token, file.name, file.type, file.size);
      await uploadFileToPresignedUrl(uploadUrl, file, setProgress);
      onUploaded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed. Please try again.");
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) startUpload(file);
  }

  const isUploading = progress !== null;

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
          isDragging
            ? "border-blue-400 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30"
            : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900"
        }`}
      >
        <span className="text-2xl" aria-hidden>
          📄
        </span>
        {isUploading ? (
          <div className="w-full max-w-xs">
            <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
              <div
                className="h-full rounded-full bg-blue-600 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Uploading… {progress}%</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Drag & drop a PDF or TXT file, or{" "}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                browse
              </button>
            </p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">Max 10 MB per file</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.txt,application/pdf,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) startUpload(file);
          }}
        />
      </div>
      {error && <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
