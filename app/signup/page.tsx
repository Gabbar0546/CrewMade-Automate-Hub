"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function SignupPage() {
  const router = useRouter();
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        email: form.get("email"),
        password: form.get("password"),
        n8nBaseUrl: form.get("n8nBaseUrl"),
        n8nApiKey: form.get("n8nApiKey"),
      }),
    });
    const data = await response.json();
    if (!response.ok) return setError(data.error || "Signup failed");
    router.push("/dashboard");
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand">Create account</div>
        <p className="muted">Connect your own n8n instance now, or add it later from Settings.</p>
        <label className="field"><span>Name</span><input className="input" name="name" required /></label>
        <label className="field"><span>Email</span><input className="input" type="email" name="email" required /></label>
        <label className="field"><span>Password</span><input className="input" type="password" name="password" minLength={8} required /></label>
        <label className="field"><span>n8n Base URL</span><input className="input" name="n8nBaseUrl" placeholder="https://n8n.example.com" /></label>
        <label className="field"><span>n8n API Key</span><input className="input" type="password" name="n8nApiKey" placeholder="n8n_api_..." /></label>
        <div className="error">{error}</div>
        <button className="btn full" type="submit">Create account</button>
        <p className="muted">Already registered? <Link href="/login">Sign in</Link></p>
      </form>
    </main>
  );
}
