"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { AuthForm, AuthField } from "@/components/AuthForm";

function VerifyForm() {
  const { confirmSignUp, resendCode } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setInfo(null);
    setIsSubmitting(true);
    try {
      await confirmSignUp(email.trim(), code.trim());
      router.push("/sign-in");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResend() {
    setError(null);
    setInfo(null);
    try {
      await resendCode(email.trim());
      setInfo("A new verification code has been sent to your email.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend code.");
    }
  }

  return (
    <AuthForm
      title="Verify your email"
      subtitle="Enter the code we sent to your inbox"
      onSubmit={handleSubmit}
      submitLabel="Verify"
      isSubmitting={isSubmitting}
      error={error}
      footer={
        <button type="button" onClick={handleResend} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
          Resend code
        </button>
      }
    >
      <AuthField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
      <AuthField label="Verification code" type="text" value={code} onChange={setCode} autoComplete="one-time-code" />
      {info && <p className="text-sm text-green-600 dark:text-green-400">{info}</p>}
    </AuthForm>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyForm />
    </Suspense>
  );
}
