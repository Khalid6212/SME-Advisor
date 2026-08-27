import { useState } from "react";
import { api } from "../api";

/**
 * Shared between the Team roster (manager/admin accounts) and a client's own
 * detail header — one mechanism for every account type, matching the API
 * side (POST /admin/users/:id/reset-password works on any role). Inline
 * reveal rather than a dialog, since it needs a text input ConfirmDialog
 * doesn't support.
 */
export function ResetPasswordButton({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 10) {
      setError("At least 10 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/users/${userId}/reset-password`, { password });
      setDone(true);
      setOpen(false);
      setPassword("");
    } catch {
      setError("Something went wrong. Try again.");
    }
    setBusy(false);
  };

  if (!open) {
    return (
      <span className="row" style={{ gap: 8, display: "inline-flex" }}>
        <button onClick={() => { setOpen(true); setDone(false); setError(null); }}>Reset password</button>
        {done && <span className="muted" style={{ fontSize: 12 }}>Password reset.</span>}
      </span>
    );
  }

  return (
    <form onSubmit={submit} className="row" style={{ gap: 6, display: "inline-flex" }}>
      <input
        type="password" autoFocus placeholder="New password" value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ width: 170 }}
      />
      <button className="primary" disabled={busy || password.length < 10}>{busy ? "…" : "Set"}</button>
      <button type="button" onClick={() => { setOpen(false); setPassword(""); setError(null); }}>Cancel</button>
      {error && <span style={{ color: "var(--bad)", fontSize: 12 }}>{error}</span>}
    </form>
  );
}
