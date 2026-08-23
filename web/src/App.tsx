import { useEffect, useState } from "react";
import { api, type ClientRow, type User } from "./api";
import { Landing } from "./screens/Landing";
import { Login } from "./screens/Login";
import { SetPassword } from "./screens/SetPassword";
import { Consent } from "./screens/Consent";
import { Interview } from "./screens/Interview";
import { ManagerInterview } from "./screens/ManagerInterview";
import { DataRoom } from "./screens/DataRoom";
import { Plan } from "./screens/Plan";
import { Admin } from "./screens/Admin";
import { HouseRules } from "./screens/HouseRules";
import { ThemeToggle } from "./components/ThemeToggle";

const READINESS: Record<string, string> = {
  ready: "good", near_ready: "info", needs_work: "warn", not_ready: "bad",
};

function Pipeline({ onOpen }: { onOpen: (c: ClientRow) => void }) {
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  useEffect(() => { api.get<ClientRow[]>("/clients").then(setRows); }, []);

  if (!rows) return <p className="muted">Loading…</p>;
  if (rows.length === 0) return <div className="card muted">No clients yet.</div>;

  return (
    <div className="card" style={{ padding: 4 }}>
      <table>
        <thead>
          <tr>
            <th>Business</th><th>Status</th><th>Readiness</th>
            <th>Claims</th><th>Open</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="clickable" onClick={() => onOpen(c)}>
              <td>
                <div>{c.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {c.contact_email}{c.group_name ? ` · ${c.group_name}` : ""}
                </div>
              </td>
              <td><span className="pill grey">{c.status.replace(/_/g, " ")}</span></td>
              <td>
                {c.readiness
                  ? <span className={`pill ${READINESS[c.readiness]}`}>{c.readiness.replace(/_/g, " ")}</span>
                  : <span className="muted">—</span>}
              </td>
              <td className="muted">{c.high_claims ?? "0"} high</td>
              <td className="muted">{c.open_requests ?? "0"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** POST /me/clients has always existed; nothing in the client view ever
 *  called it. Self-signup got you an account with nowhere to go next. */
function NewBusiness({ onCreated }: { onCreated: (client: ClientRow) => void }) {
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ client_id: string }>("/me/clients", {
        name: name.trim(),
        brief: brief.trim(),
      });
      onCreated({
        id: r.client_id, name: name.trim(), status: "interviewing", sector_id: "general",
        created_at: new Date().toISOString(), closed_at: null, group_name: null, readiness: null,
      });
    } catch {
      setError("Something went wrong. Try again.");
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <div style={{ fontWeight: 600, marginBottom: 10 }}>Tell us about your business</div>
      <label className="muted" style={{ fontSize: 12 }}>Business name</label>
      <input
        required value={name} autoFocus
        onChange={(e) => setName(e.target.value)}
        style={{ margin: "6px 0 14px", width: "100%" }}
      />
      <label className="muted" style={{ fontSize: 12 }}>What does it do?</label>
      <textarea
        required value={brief} rows={3}
        onChange={(e) => setBrief(e.target.value)}
        placeholder="A sentence or two — this opens the assessment, so specifics beat a general description."
        style={{ margin: "6px 0 14px", width: "100%" }}
      />
      {error && <p style={{ color: "var(--bad)", fontSize: 13, marginTop: 0 }}>{error}</p>}
      <button className="primary" disabled={busy || !name.trim() || !brief.trim()}>
        {busy ? "Starting…" : "Start"}
      </button>
    </form>
  );
}

function Tabs({ tabs, active, onChange }: {
  tabs: string[]; active: string; onChange: (t: string) => void;
}) {
  return (
    <div className="row" role="tablist" style={{ gap: 6, margin: "18px 0" }}>
      {tabs.map((t) => (
        <button
          key={t} role="tab" aria-selected={t === active} onClick={() => onChange(t)}
          style={t === active ? { borderColor: "var(--info)", color: "var(--info)" } : undefined}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null | "loading">("loading");
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [open, setOpen] = useState<ClientRow | null>(null);
  const [tab, setTab] = useState("Data room");
  const [view, setView] = useState<"pipeline" | "admin" | "rules">("pipeline");
  const [residency, setResidency] = useState<string | null>(null);
  const [unauthView, setUnauthView] = useState<"landing" | "login">("landing");

  useEffect(() => {
    api.get<User>("/auth/me").then(setUser).catch(() => setUser(null));
    api.get<{ data_residency: string }>("/health")
      .then((h) => setResidency(h.data_residency))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (user && user !== "loading" && user.role === "client") {
      api.get<ClientRow[]>("/me/clients").then(setClients);
    }
  }, [user]);

  if (user === "loading") return <p className="muted" style={{ padding: 40 }} aria-live="polite">Loading…</p>;
  if (!user) {
    return unauthView === "landing"
      ? <Landing onSignIn={() => setUnauthView("login")} />
      : <Login onBack={() => setUnauthView("landing")} />;
  }
  // The only way to reach this with has_password false is a magic link that
  // just verified — there's a real session already, it just can't be used
  // for anything else until this step closes.
  if (!user.has_password) {
    return <SetPassword email={user.email} onDone={() => location.reload()} />;
  }
  // Clients only — a manager account was provisioned deliberately, not
  // self-signed-up, so the interview consent gate does not apply to them.
  if (user.role === "client" && !user.has_consented) {
    return <Consent onDone={() => location.reload()} />;
  }

  const manager = user.role === "manager" || user.role === "admin";
  const active = open ?? clients[0] ?? null;

  return (
    <div>
      {/* Synthetic-data banner. A warning only in a log is not a control. */}
      {residency === "development" && (
        <div className="banner">
          Development database — synthetic data only. Real client data requires
          in-Kingdom hosting.
        </div>
      )}

      <div className="topbar">
        <span className="brand">SME Advisor</span>
        {manager && <span className="pill info">Investment team</span>}
        {user.role === "admin" && (
          <button
            style={view === "admin" ? { borderColor: "var(--info)", color: "var(--info)" } : undefined}
            onClick={() => setView(view === "admin" ? "pipeline" : "admin")}
          >
            Team
          </button>
        )}
        {manager && (
          <button
            style={view === "rules" ? { borderColor: "var(--info)", color: "var(--info)" } : undefined}
            onClick={() => setView(view === "rules" ? "pipeline" : "rules")}
          >
            House rules
          </button>
        )}
        <div className="spacer" />
        <ThemeToggle />
        <span className="muted" style={{ fontSize: 13 }}>{user.email}</span>
        <button onClick={() => api.post("/auth/logout").then(() => location.reload())}>
          Sign out
        </button>
      </div>

      <div className="shell">
        {view === "admin" ? (
          <>
            <h1>Team</h1>
            <p className="sub">Advisors and admins who can access the platform.</p>
            <Admin currentUserId={user.id} />
          </>
        ) : view === "rules" ? (
          <>
            <h1>House rules</h1>
            <p className="sub">
              Patterns the team's edits have taught the drafting agents — nothing here applies
              until you approve it.
            </p>
            <HouseRules />
          </>
        ) : manager ? (
          open ? (
            <>
              <button onClick={() => setOpen(null)} style={{ marginTop: 20 }}>← Pipeline</button>
              <h1>{open.name}</h1>
              <p className="sub">{open.contact_email} · {open.status.replace(/_/g, " ")}</p>
              <Tabs tabs={["Interview", "Data room", "Plans"]} active={tab} onChange={setTab} />
              {tab === "Plans"
                ? <Plan clientId={open.id} />
                : tab === "Interview"
                  ? <ManagerInterview clientId={open.id} />
                  : <DataRoom clientId={open.id} manager />}
            </>
          ) : (
            <>
              <h1>Client pipeline</h1>
              <p className="sub">Assessments awaiting review, and engagements in progress.</p>
              <Pipeline onOpen={(c) => { setOpen(c); setTab("Data room"); }} />
            </>
          )
        ) : (
          <>
            <h1>{active?.name ?? "Your business"}</h1>
            <p className="sub">
              Just questions and the documents your adviser asks for. Nothing else.
            </p>
            {clients.length > 1 && (
              <div className="row" style={{ gap: 6, marginBottom: 12 }}>
                {clients.map((c) => (
                  <button key={c.id} onClick={() => setOpen(c)}
                    style={c.id === active?.id ? { borderColor: "var(--info)", color: "var(--info)" } : undefined}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
            {active ? (
              <>
                <Tabs tabs={["Assessment", "Documents"]} active={tab === "Data room" ? "Documents" : tab}
                      onChange={setTab} />
                {tab === "Assessment"
                  ? <Interview clientId={active.id} />
                  : <DataRoom clientId={active.id} manager={false} />}
              </>
            ) : (
              <NewBusiness onCreated={(c) => { setClients((prev) => [...prev, c]); setOpen(c); }} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
