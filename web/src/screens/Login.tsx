import { useState } from "react";
import { api } from "../api";

/**
 * Magic link only. Nothing here ever holds a password or a token — the API
 * sets an httpOnly cookie on verification.
 */
export function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    // The API replies 204 whether or not the address is known, so it cannot be
    // used to discover who has an account. The UI must say the same either way.
    await api.post("/auth/magic-link", { email: email.trim() });
    setSent(true);
    setBusy(false);
  };

  return (
    <div style={{ maxWidth: 420, margin: "12vh auto", padding: "0 24px" }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 26, fontWeight: 700 }}>مستشار الجاهزية الاستثمارية</div>
        <div className="dim" style={{ fontSize: 15 }}>SME Investment Readiness</div>
      </div>

      {sent ? (
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Check your email</div>
          <p className="muted" style={{ margin: 0 }}>
            If an account exists for <strong className="dim">{email}</strong>, a sign-in
            link is on its way. It expires in 15 minutes and works once.
          </p>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            In development the link is printed to the API console rather than emailed.
          </p>
          <button style={{ marginTop: 14 }} onClick={() => setSent(false)}>
            Use a different email
          </button>
        </div>
      ) : (
        <form className="card" onSubmit={submit}>
          <label className="muted" style={{ fontSize: 12 }}>Email</label>
          <input
            type="email" required value={email} autoFocus
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.sa"
            style={{ margin: "6px 0 14px" }}
          />
          <button className="primary" style={{ width: "100%" }} disabled={busy || !email.trim()}>
            {busy ? "Sending…" : "Send sign-in link"}
          </button>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 14 }}>
            No password. We email you a link.
          </p>
        </form>
      )}
    </div>
  );
}
