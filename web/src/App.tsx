import { useEffect, useState } from "react";
import { api, ApiError, type ClientRow, type User } from "./api";
import { Landing } from "./screens/Landing";
import { Login } from "./screens/Login";
import { SetPassword } from "./screens/SetPassword";
import { Consent } from "./screens/Consent";
import { Interview } from "./screens/Interview";
import { ManagerInterview } from "./screens/ManagerInterview";
import { DataRoom } from "./screens/DataRoom";
import { Findings } from "./screens/Findings";
import { Plan } from "./screens/Plan";
import { Admin } from "./screens/Admin";
import { HouseRules } from "./screens/HouseRules";
import { ThemeToggle } from "./components/ThemeToggle";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ResetPasswordButton } from "./components/ResetPasswordButton";

const READINESS: Record<string, string> = {
  ready: "good", near_ready: "info", needs_work: "warn", not_ready: "bad",
};

/** Permanent — the business, its interview, documents, and any plan are all
 *  gone, at any stage, not just early ones. Available to managers and admins
 *  alike (requireManager on the API side covers both), which is why this
 *  lives right on the client header rather than behind an admin-only screen. */
function DeleteClientButton({ client, onDeleted }: { client: ClientRow; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.del(`/clients/${client.id}`);
      onDeleted();
    } catch {
      setError("Couldn't delete this client. Try again.");
      setBusy(false);
    }
  };

  return (
    <>
      <button
        style={{ borderColor: "var(--bad)", color: "var(--bad)" }}
        onClick={() => setConfirming(true)}
      >
        Delete client
      </button>
      {error && <span style={{ color: "var(--bad)", fontSize: 13, marginLeft: 10 }}>{error}</span>}
      <ConfirmDialog
        open={confirming}
        danger
        title={`Delete ${client.name}?`}
        message="This permanently removes the business, its interview, every document, and any plan — there is no undo. This bypasses the usual retention period, so make sure this is really what you want."
        confirmLabel="Delete permanently"
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

/** Onboards a client the advisor already has a relationship with, rather
 *  than waiting for them to find the login page and self-serve. Mirrors
 *  Admin.tsx's "Invite an advisor" form — same shape, different endpoint
 *  and a longer-lived link, since this is someone's first contact with the
 *  platform rather than a returning teammate signing back in. */
type Delivery = "link" | "credentials" | "permanent";

function InviteClient({ isAdmin, onInvited }: { isAdmin: boolean; onInvited: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [delivery, setDelivery] = useState<Delivery>("link");
  const [password, setPassword] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ email: string; delivery: Delivery; emailed: boolean } | null>(null);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (delivery === "permanent" && password.length < 10) {
      setError("Password needs at least 10 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.post<{ emailed: boolean }>("/clients/invite", {
        email: email.trim(),
        name: name.trim(),
        delivery,
        ...(delivery === "permanent" ? { password, send_email: sendEmail } : {}),
      });
      setResult({ email: email.trim(), delivery, emailed: r.emailed });
      setEmail("");
      setName("");
      setPassword("");
      onInvited();
    } catch (err: unknown) {
      setError(
        err instanceof ApiError && err.code === "email_is_team_member"
          ? "That address already belongs to someone on the team."
          : err instanceof ApiError && err.code === "client_already_has_account"
            ? "That client already has an account with its own password — use Reset password instead."
            : "Couldn't send the invite. Check the details and try again.",
      );
    }
    setBusy(false);
  };

  if (!open) {
    return (
      <button className="primary" style={{ marginBottom: 12 }} onClick={() => setOpen(true)}>
        + Invite client
      </button>
    );
  }

  return (
    <div className="card">
      <div style={{ fontWeight: 600, marginBottom: 10 }}>Invite a client</div>
      <form onSubmit={invite}>
        <div className="row" style={{ gap: 8 }}>
          <input
            required value={name} placeholder="Business name" autoFocus
            onChange={(e) => setName(e.target.value)}
            style={{ flex: 1 }}
          />
          <input
            type="email" required value={email} placeholder="owner@company.sa"
            onChange={(e) => setEmail(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>
        <div className="stack" style={{ gap: 4, margin: "10px 0" }}>
          <label className="row" style={{ gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input
              type="radio" name="delivery" checked={delivery === "link"}
              onChange={() => setDelivery("link")} style={{ width: "auto" }}
            />
            Email a sign-in link (recommended) — expires in 48 hours, verifies their address
          </label>
          <label className="row" style={{ gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input
              type="radio" name="delivery" checked={delivery === "credentials"}
              onChange={() => setDelivery("credentials")} style={{ width: "auto" }}
            />
            Email login credentials directly — no link to click, but a weaker first step
          </label>
          {isAdmin && (
            <label className="row" style={{ gap: 8, fontSize: 13, cursor: "pointer" }}>
              <input
                type="radio" name="delivery" checked={delivery === "permanent"}
                onChange={() => setDelivery("permanent")} style={{ width: "auto" }}
              />
              Set a permanent password myself (admin only) — no login or setup step for them at all
            </label>
          )}
        </div>
        {delivery === "permanent" && (
          <div className="stack" style={{ gap: 8, margin: "0 0 10px" }}>
            <input
              type="password" required value={password} placeholder="Password (min. 10 characters)"
              onChange={(e) => setPassword(e.target.value)}
            />
            <label className="row" style={{ gap: 8, fontSize: 13, cursor: "pointer" }}>
              <input
                type="checkbox" checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)} style={{ width: "auto" }}
              />
              Also email these credentials to the client
            </label>
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <button className="primary" disabled={busy || !email.trim() || !name.trim()}>
            {busy ? "Sending…" : "Send invite"}
          </button>
          <button type="button" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      </form>
      {result && (
        <p className="muted" style={{ fontSize: 13, marginTop: 10, marginBottom: 0 }}>
          {result.delivery === "link"
            ? <>Invite sent to <strong className="dim">{result.email}</strong>. The link works once, expires in 48 hours, and takes them straight to setting a password.</>
            : result.delivery === "credentials"
              ? <>Credentials emailed to <strong className="dim">{result.email}</strong>. They'll be forced to set their own password the moment they sign in.</>
              : result.emailed
                ? <>Account created for <strong className="dim">{result.email}</strong> and credentials emailed. The password stays as set — no forced change.</>
                : <>Account created for <strong className="dim">{result.email}</strong>. Nothing was emailed — you'll need to share the password yourself.</>}
        </p>
      )}
      {error && <p style={{ color: "var(--bad)", fontSize: 13, marginTop: 10, marginBottom: 0 }}>{error}</p>}
    </div>
  );
}

function Pipeline({ isAdmin, onOpen }: { isAdmin: boolean; onOpen: (c: ClientRow) => void }) {
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const load = () => api.get<ClientRow[]>("/clients").then(setRows);
  useEffect(() => { void load(); }, []);

  return (
    <div>
      <InviteClient isAdmin={isAdmin} onInvited={load} />
      {!rows ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card muted">No clients yet.</div>
      ) : (
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
      )}
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
  // just verified; must_change_password is the other route in — an
  // advisor-generated password that's only valid for this one sign-in.
  // Either way there's a real session already, it just can't be used for
  // anything else until this step closes.
  if (!user.has_password || user.must_change_password) {
    return (
      <SetPassword
        email={user.email}
        reason={user.must_change_password ? "temporary_password" : "magic_link"}
        onDone={() => location.reload()}
      />
    );
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
              <div className="row" style={{ marginTop: 20, justifyContent: "space-between" }}>
                <button onClick={() => setOpen(null)}>← Pipeline</button>
                <div className="row" style={{ gap: 8 }}>
                  {user.role === "admin" && open.owner_user_id && (
                    <ResetPasswordButton userId={open.owner_user_id} />
                  )}
                  <DeleteClientButton client={open} onDeleted={() => setOpen(null)} />
                </div>
              </div>
              <h1>{open.name}</h1>
              <p className="sub">{open.contact_email} · {open.status.replace(/_/g, " ")}</p>
              <Tabs tabs={["Interview", "Data room", "Findings", "Plans"]} active={tab} onChange={setTab} />
              {tab === "Plans"
                ? <Plan clientId={open.id} />
                : tab === "Interview"
                  ? <ManagerInterview clientId={open.id} />
                  : tab === "Findings"
                    ? <Findings clientId={open.id} />
                    : <DataRoom clientId={open.id} manager />}
            </>
          ) : (
            <>
              <h1>Client pipeline</h1>
              <p className="sub">Assessments awaiting review, and engagements in progress.</p>
              <Pipeline isAdmin={user.role === "admin"} onOpen={(c) => { setOpen(c); setTab("Data room"); }} />
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
