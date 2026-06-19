"use client";

import { useState, Suspense, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TextField, Button } from "@/components/admin/ui";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error || "Incorrect password");
      return;
    }
    router.push(searchParams.get("next") || "/admin");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="glass-card flex w-full max-w-sm flex-col gap-4 p-8">
      <h1 className="text-2xl font-bold">Sign in</h1>
      <TextField
        label="Password"
        type="password"
        autoFocus
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button type="submit" disabled={loading}>
        {loading ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
