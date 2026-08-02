"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    });
    const data = await response.json();
    if (!response.ok) return setError(data.error || "Sign in failed");
    router.push("/dashboard");
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand">Automation Hub</div>
        <p className="muted">Sign in to manage n8n workflows, users, and automation assets.</p>
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" name="email" required autoComplete="email" placeholder="you@example.com" />
        </label>
        <label className="field">
          <span>Password</span>
          <input className="input" type="password" name="password" required autoComplete="current-password" placeholder="Enter your password" />
        </label>
        <div className="error">{error}</div>
        <button className="btn full" type="submit">Sign in</button>
        <p className="muted">New user? <Link href="/signup">Create an account</Link></p>
      </form>
    </main>
  );
}
