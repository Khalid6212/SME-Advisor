import { useEffect, useState } from "react";
import { api, type AccountRow, type AgentUsageResponse } from "../api";
import { ResetPasswordButton } from "../components/ResetPasswordButton";

const ROLE_PILL: Record<string, string> = { admin: "info", manager: "good", client: "grey" };

const AGENT_LABELS: Record<string, string> = {
  "phase.company_market": "Company & market",
  "phase.strategy": "Strategy",
  "phase.operations": "Operations",
  "phase.financial": "Financial plan",
  "phase.investment_case": "Investment case",
  "phase.summary": "Executive summary",
  planner: "Planner (legacy)",
  interview: "Interview",
  extract: "Document extraction",
  reconcile: "Reconciliation",
  distiller: "House-rule distiller",
  research: "Market research",
  ledger: "Ledger analyst",
};

function agentLabel(agent: string): string {
  return AGENT_LABELS[agent] ?? agent;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * A read-only view over agent.usage audit events every agent already logs
 * (see audit() calls in api/src/agents/*.ts) — no new instrumentation, just
 * a rollup. $ figures are estimates from list pricing, not a billing feed.
 */
function AgentUsagePanel() {
  const [usage, setUsage] = useState<AgentUsageResponse | null>(null);

  useEffect(() => { void api.get<AgentUsageResponse>("/admin/agent-usage").then(setUsage); }, []);

  if (!usage) return <p className="muted">Loading…</p>;
  if (usage.usage.length === 0) return <div className="card muted">No agent activity logged yet.</div>;

  return (
    <div className="card" style={{ padding: 4, marginTop: 16 }}>
      <div style={{ padding: "10px 14px 0" }}>
        <div className="row">
          <div style={{ fontWeight: 600, flex: 1 }}>Agent usage</div>
          <span className="muted" style={{ fontSize: 12 }}>
            Estimated from list pricing, not a billing feed
          </span>
        </div>
      </div>
      <table className="ft">
        <thead>
          <tr>
            <th>Agent</th><th>Model</th><th>Calls</th><th>Input</th><th>Output</th>
            <th>Cache read</th><th>Cache write</th><th>Est. cost</th><th>Last call</th>
          </tr>
        </thead>
        <tbody>
          {usage.usage.map((u) => (
            <tr key={`${u.agent}:${u.model}`}>
              <td>{agentLabel(u.agent)}</td>
              <td className="muted">{u.model}</td>
              <td>{u.calls}</td>
              <td>{fmtTokens(u.input_tokens)}</td>
              <td>{fmtTokens(u.output_tokens)}</td>
              <td className="muted">{fmtTokens(u.cache_read_tokens)}</td>
              <td className="muted">{fmtTokens(u.cache_write_tokens)}</td>
              <td>{u.estimated_cost_usd !== null ? `$${u.estimated_cost_usd.toFixed(2)}` : "—"}</td>
              <td className="muted">{new Date(u.last_call).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ padding: "10px 14px", justifyContent: "flex-end" }}>
        <strong>
          Total: {usage.total_estimated_cost_usd !== null ? `$${usage.total_estimated_cost_usd.toFixed(2)}` : "—"}
        </strong>
      </div>
    </div>
  );
}

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
          <table className="ft">
            <thead>
              <tr>
                <th>Email</th><th>Role</th><th>Status</th><th>Password set</th>
                <th>Last seen</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td className="num">{u.email}</td>
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
                    <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                      {u.id !== currentUserId && (
                        <button
                          disabled={busy === u.id}
                          onClick={() => setStatus(u.id, u.status === "active" ? "disabled" : "active")}
                        >
                          {busy === u.id ? "…" : u.status === "active" ? "Disable" : "Re-enable"}
                        </button>
                      )}
                      <ResetPasswordButton userId={u.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AgentUsagePanel />
    </div>
  );
}
