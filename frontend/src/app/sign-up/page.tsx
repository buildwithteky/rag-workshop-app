"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { AuthForm, AuthField } from "@/components/AuthForm";

export default function SignUpPage() {
  const { signUp } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setIsSubmitting(true);
    try {
      await signUp(email.trim(), password);
      router.push(`/verify?email=${encodeURIComponent(email.trim())}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthForm
      title="Create your account"
      subtitle="Your documents and chats stay private to you"
      onSubmit={handleSubmit}
      submitLabel="Sign up"
      isSubmitting={isSubmitting}
      error={error}
      footer={
        <>
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
            Sign in
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
        autoComplete="new-password"
        placeholder="At least 8 characters, upper+lowercase+number"
      />
      <AuthField
        label="Confirm password"
        type="password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        autoComplete="new-password"
      />
    </AuthForm>
  );
}
