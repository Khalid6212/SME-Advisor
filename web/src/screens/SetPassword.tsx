import { useState } from "react";
import { api } from "../api";

/**
 * Reached two ways: a just-verified magic link with no password yet, or an
 * advisor-generated temporary password that must be replaced before anything
 * else is reachable. Either way there's already a session by the time this
 * renders — this just attaches a permanent password to it.
 */
export function SetPassword({
  email,
  reason = "magic_link",
  onDone,
}: {
  email: string;
  reason?: "magic_link" | "temporary_password";
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 10) return setError("At least 10 characters.");
    if (password !== confirm) return setError("Passwords don't match.");

    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/set-password", { password });
      onDone();
    } catch {
      setError("Something went wrong. Try again.");
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: "12vh auto", padding: "0 24px" }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Set your password</div>
        <div className="dim" style={{ fontSize: 14 }}>{email}</div>
      </div>

      <form className="card" onSubmit={submit}>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          {reason === "temporary_password"
            ? "You signed in with a temporary password your adviser emailed you. Set your own now — the temporary one won't work again."
            : "You're signed in via the link that was just emailed to you. Set a password now and use it to sign in from here on — the link stays useful if you ever forget it."}
        </p>
        <label className="muted" style={{ fontSize: 12 }}>New password</label>
        <input
          type="password" required autoFocus value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ margin: "6px 0 14px" }}
        />
        <label className="muted" style={{ fontSize: 12 }}>Confirm password</label>
        <input
          type="password" required value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          style={{ margin: "6px 0 14px" }}
        />
        {error && <p style={{ color: "var(--bad)", fontSize: 13, marginTop: 0 }}>{error}</p>}
        <button className="primary" style={{ width: "100%" }} disabled={busy || !password || !confirm}>
          {busy ? "Saving…" : "Set password and continue"}
        </button>
      </form>
    </div>
  );
}
