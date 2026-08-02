import { useEffect, useState } from "react";
import { api, type ClientRow, type User } from "./api";
import { Login } from "./screens/Login";
import { Interview } from "./screens/Interview";
import { DataRoom } from "./screens/DataRoom";

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

function Tabs({ tabs, active, onChange }: {
  tabs: string[]; active: string; onChange: (t: string) => void;
}) {
  return (
    <div className="row" style={{ gap: 6, margin: "18px 0" }}>
      {tabs.map((t) => (
        <button key={t} onClick={() => onChange(t)}
          style={t === active ? { borderColor: "var(--info)", color: "var(--info)" } : undefined}>
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
  const [residency, setResidency] = useState<string | null>(null);

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

  if (user === "loading") return <p className="muted" style={{ padding: 40 }}>Loading…</p>;
  if (!user) return <Login />;

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
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 13 }}>{user.email}</span>
        <button onClick={() => api.post("/auth/logout").then(() => location.reload())}>
          Sign out
        </button>
      </div>

      <div className="shell">
        {manager ? (
          open ? (
            <>
              <button onClick={() => setOpen(null)} style={{ marginTop: 20 }}>← Pipeline</button>
              <h1>{open.name}</h1>
              <p className="sub">{open.contact_email} · {open.status.replace(/_/g, " ")}</p>
              <Tabs tabs={["Data room"]} active={tab} onChange={setTab} />
              <DataRoom clientId={open.id} manager />
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
              <div className="card muted">No business yet.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
