import { useEffect, useState } from "react";
import { api, type AccountRow } from "../api";

const ROLE_PILL: Record<string, string> = { admin: "info", manager: "good", client: "grey" };

export function Admin({ currentUserId }: { currentUserId: string }) {
  const [rows, setRows] = useState<AccountRow[] | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState<string | null>(null);

  const load = () => api.get<AccountRow[]>("/admin/users").then(setRows);
  useEffect(() => { void load(); }, []);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("invite");
    setError(null);
    setInvited(null);
    try {
      await api.post("/admin/managers", { email: email.trim() });
      setInvited(email.trim());
      setEmail("");
      await load();
    } catch {
      setError("Couldn't send the invite. Check the address and try again.");
    }
    setBusy(null);
  };

  const setStatus = async (id: string, status: "active" | "disabled") => {
    setBusy(id);
    await api.patch(`/admin/users/${id}`, { status });
    await load();
    setBusy(null);
  };

  return (
    <div>
      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Invite an advisor</div>
        <form className="row" onSubmit={invite} style={{ gap: 8 }}>
          <input
            type="email" required value={email} placeholder="advisor@company.sa"
            onChange={(e) => setEmail(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="primary" disabled={busy === "invite" || !email.trim()}>
            {busy === "invite" ? "Sending…" : "Send invite"}
          </button>
        </form>
        {invited && (
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            Sign-in link sent to <strong className="dim">{invited}</strong>. It doubles as
            their account setup — they'll be asked to set a password after clicking it.
          </p>
        )}
        {error && <p style={{ color: "var(--bad)", fontSize: 13, marginBottom: 0 }}>{error}</p>}
      </div>

      {!rows ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="card" style={{ padding: 4 }}>
          <table>
            <thead>
              <tr>
                <th>Email</th><th>Role</th><th>Status</th><th>Password set</th>
                <th>Last seen</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td><span className={`pill ${ROLE_PILL[u.role] ?? "grey"}`}>{u.role}</span></td>
                  <td>
                    <span className={`pill ${u.status === "active" ? "good" : "bad"}`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="muted">{u.has_password ? "yes" : "not yet"}</td>
                  <td className="muted">
                    {u.last_seen_at ? new Date(u.last_seen_at).toLocaleDateString() : "never"}
                  </td>
                  <td>
                    {u.id !== currentUserId && (
                      <button
                        disabled={busy === u.id}
                        onClick={() => setStatus(u.id, u.status === "active" ? "disabled" : "active")}
                      >
                        {busy === u.id ? "…" : u.status === "active" ? "Disable" : "Re-enable"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
