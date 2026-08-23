import { useState } from "react";
import { api, ApiError } from "../api";

/**
 * Password is the everyday path once an account exists. The magic link is
 * what gets you there in the first place, and what gets you back in if the
 * password is forgotten — one mechanism for both, not two to keep in sync.
 */
export function Login({ onBack }: { onBack?: () => void }) {
  const [mode, setMode] = useState<"password" | "link">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/login", { email: email.trim(), password });
      location.reload();
    } catch (err: unknown) {
      setError(
        err instanceof ApiError && err.code === "rate_limited"
          ? "Too many attempts. Try again in a few minutes."
          : "Incorrect email or password.",
      );
    }
    setBusy(false);
  };

  const submitLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // The API replies 204 whether or not the address is known, so it cannot
      // be used to discover who has an account. The UI must say the same
      // either way.
      await api.post("/auth/magic-link", { email: email.trim() });
      setSent(true);
    } catch (err: unknown) {
      setError(err instanceof ApiError && err.code === "rate_limited"
        ? "Too many requests. Try again in a few minutes."
        : "Something went wrong. Try again.");
    }
    setBusy(false);
  };

  return (
    <div style={{ maxWidth: 420, margin: "12vh auto", padding: "0 24px" }}>
      {onBack && (
        <a href="#" onClick={(e) => { e.preventDefault(); onBack(); }} style={{ fontSize: 13 }}>
          ← Back
        </a>
      )}
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 26, fontWeight: 700 }}>مستشار الجاهزية الاستثمارية</div>
        <div className="dim" style={{ fontSize: 15 }}>SME Investment Readiness</div>
      </div>

      {sent ? (
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Check your email</div>
          <p className="muted" style={{ margin: 0 }}>
            If an account exists for <strong className="dim">{email}</strong>, a sign-in
            link is on its way. It expires in 15 minutes and works once — new here or
            resetting a password, it takes you to the same place.
          </p>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            In development the link is printed to the API console rather than emailed.
          </p>
          <button style={{ marginTop: 14 }} onClick={() => { setSent(false); setMode("password"); }}>
            Back to sign in
          </button>
        </div>
      ) : mode === "password" ? (
        <form className="card" onSubmit={submitPassword}>
          <label className="muted" style={{ fontSize: 12 }}>Email</label>
          <input
            type="email" required value={email} autoFocus
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.sa"
            style={{ margin: "6px 0 14px" }}
          />
          <label className="muted" style={{ fontSize: 12 }}>Password</label>
          <input
            type="password" required value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ margin: "6px 0 14px" }}
          />
          {error && <p style={{ color: "var(--bad)", fontSize: 13, marginTop: 0 }}>{error}</p>}
          <button className="primary" style={{ width: "100%" }} disabled={busy || !email.trim() || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 14 }}>
            New here, or forgot your password?{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); setError(null); setMode("link"); }}>
              Email me a sign-in link
            </a>
          </p>
        </form>
      ) : (
        <form className="card" onSubmit={submitLink}>
          <label className="muted" style={{ fontSize: 12 }}>Email</label>
          <input
            type="email" required value={email} autoFocus
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.sa"
            style={{ margin: "6px 0 14px" }}
          />
          {error && <p style={{ color: "var(--bad)", fontSize: 13, marginTop: 0 }}>{error}</p>}
          <button className="primary" style={{ width: "100%" }} disabled={busy || !email.trim()}>
            {busy ? "Sending…" : "Send sign-in link"}
          </button>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 14 }}>
            <a href="#" onClick={(e) => { e.preventDefault(); setError(null); setMode("password"); }}>
              Back to password sign-in
            </a>
          </p>
        </form>
      )}
    </div>
  );
}
