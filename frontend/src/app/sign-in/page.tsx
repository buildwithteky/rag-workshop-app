"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { AuthForm, AuthField } from "@/components/AuthForm";

export default function SignInPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await signIn(email.trim(), password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthForm
      title="Sign in"
      subtitle="Access your private document workspace"
      onSubmit={handleSubmit}
      submitLabel="Sign in"
      isSubmitting={isSubmitting}
      error={error}
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link href="/sign-up" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
            Sign up
          </Link>
        </>
      }
    >
      <AuthField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
      <AuthField
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
      />
    </AuthForm>
  );
}
