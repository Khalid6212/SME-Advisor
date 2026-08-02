import { useEffect, useState } from "react";
import { api } from "../api";

interface Template {
  key: string; audience: string; name: { en: string }; purpose: string;
  sections: number; needs_input: string[];
}
interface Section {
  id: string; key: string; title_en: string; content: string;
  provenance: { statement: string; source: string; ref: string }[];
  confidence: string | null; status: string;
}
interface Gap {
  id: string; section_key: string; question: string;
  why_it_matters: string; blocking: boolean; request_id: string | null;
}
interface PlanView {
  plan: { id: string; version: number; readiness: string | null; manager_note: string | null;
          template_key: string; profile_superseded: boolean };
  sections: Section[];
  assumptions: { label: string; value: string; basis: string }[];
  gaps: Gap[];
}

const CONFIDENCE: Record<string, string> = {
  well_supported: "good", thin: "warn", blocked: "bad",
};

export function Plan({ clientId }: { clientId: string }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [plans, setPlans] = useState<{ id: string; version: number; template_key: string }[]>([]);
  const [view, setView] = useState<PlanView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");

  const loadList = async () => setPlans(await api.get(`/clients/${clientId}/plans`));

  useEffect(() => {
    api.get<Template[]>("/plan-templates").then(setTemplates);
    void loadList();
  }, [clientId]);

  const openPlan = async (id: string) => setView(await api.get<PlanView>(`/plans/${id}`));

  const generate = async (key: string) => {
    setBusy(key);
    setError(null);
    try {
      const r = await api.post<{ plan_id: string }>(`/clients/${clientId}/plans`, { template_key: key });
      await loadList();
      await openPlan(r.plan_id);
    } catch (e: any) {
      setError(
        e.code === "no_profile"
          ? "The interview needs to be completed before a plan can be drafted."
          : "The planner is unavailable right now.",
      );
    }
    setBusy(null);
  };

  const save = async (s: Section) => {
    setBusy(s.id);
    await api.patch(`/plan-sections/${s.id}`, {
      content: draft,
      status: "edited",
      note: note.trim() || undefined,
    });
    setEditing(null);
    setNote("");
    if (view) await openPlan(view.plan.id);
    setBusy(null);
  };

  const requestGap = async (g: Gap) => {
    setBusy(g.id);
    await api.post(`/plan-gaps/${g.id}/request`);
    if (view) await openPlan(view.plan.id);
    setBusy(null);
  };

  return (
    <div>
      <div className="card">
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {templates.map((t) => (
            <button key={t.key} onClick={() => generate(t.key)} disabled={!!busy}
                    className={t.audience === "lender" ? "primary" : ""}>
              {busy === t.key ? "Drafting…" : `Draft ${t.name.en}`}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          {plans.map((p) => (
            <button key={p.id} onClick={() => openPlan(p.id)}>
              v{p.version} · {p.template_key.includes("internal") ? "operating" : "lender"}
            </button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
          Drafting runs the agent over the profile and takes a minute or so.
          Strategy and projections come back as questions, not prose — they
          aren't in a discovery interview.
        </p>
        {error && <p style={{ color: "var(--bad)", marginBottom: 0 }}>{error}</p>}
      </div>

      {!view ? null : (
        <>
          {view.plan.profile_superseded && (
            <div className="card" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>
              The profile has changed since this plan was drafted. Regenerate before sending it anywhere.
            </div>
          )}

          {view.plan.manager_note && (
            <div className="card">
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 }}>
                From the planner
              </div>
              <p style={{ margin: "6px 0 0" }}>{view.plan.manager_note}</p>
            </div>
          )}

          {view.gaps.length > 0 && (
            <>
              <h2>Gaps ({view.gaps.length})</h2>
              {view.gaps.map((g) => (
                <div key={g.id} className="card">
                  <div className="row">
                    <span className={`pill ${g.blocking ? "bad" : "grey"}`}>
                      {g.blocking ? "blocking" : "optional"}
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>{g.section_key}</span>
                    <div style={{ flex: 1 }} />
                    {g.request_id
                      ? <span className="pill info">requested</span>
                      : <button onClick={() => requestGap(g)} disabled={busy === g.id}>
                          Ask the client
                        </button>}
                  </div>
                  <p style={{ margin: "8px 0 4px" }}>{g.question}</p>
                  <p className="muted" style={{ fontSize: 12, margin: 0 }}>{g.why_it_matters}</p>
                </div>
              ))}
            </>
          )}

          <h2>Sections</h2>
          {view.sections.map((s) => (
            <div key={s.id} className="card">
              <div className="row">
                <strong style={{ flex: 1 }}>{s.title_en}</strong>
                {s.confidence && (
                  <span className={`pill ${CONFIDENCE[s.confidence] ?? "grey"}`}>{s.confidence.replace(/_/g, " ")}</span>
                )}
                <span className="pill grey">{s.status}</span>
                {editing !== s.id && (
                  <button onClick={() => { setEditing(s.id); setDraft(s.content); }}>Edit</button>
                )}
              </div>

              {editing === s.id ? (
                <div className="stack" style={{ marginTop: 10 }}>
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
                            style={{ minHeight: 220, resize: "vertical" }} />
                  {/* Optional, and worth more than the diff — see D19. */}
                  <input value={note} onChange={(e) => setNote(e.target.value)}
                         placeholder="Why did you change it? (optional — helps the agent learn)" />
                  <div className="row">
                    <button className="primary" onClick={() => save(s)} disabled={busy === s.id}>
                      {busy === s.id ? "Saving…" : "Save"}
                    </button>
                    <button onClick={() => { setEditing(null); setNote(""); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <p style={{ whiteSpace: "pre-wrap", marginBottom: 0 }} dir="auto">
                  {s.content || <span className="muted">Not drafted — see gaps above.</span>}
                </p>
              )}

              {s.provenance?.length > 0 && editing !== s.id && (
                <details style={{ marginTop: 10 }}>
                  <summary className="muted" style={{ fontSize: 12, cursor: "pointer" }}>
                    {s.provenance.length} sourced statement{s.provenance.length === 1 ? "" : "s"}
                  </summary>
                  {s.provenance.map((p, i) => (
                    <div key={i} className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                      <span className="pill grey">{p.source}</span> {p.statement}
                      <span className="dim"> — {p.ref}</span>
                    </div>
                  ))}
                </details>
              )}
            </div>
          ))}

          {view.assumptions.length > 0 && (
            <>
              <h2>Assumptions</h2>
              <div className="card">
                {view.assumptions.map((a, i) => (
                  <div key={i} className="row" style={{ borderTop: i ? "1px solid var(--line)" : undefined, padding: "8px 0" }}>
                    <span style={{ flex: 1 }}>{a.label}</span>
                    <strong>{a.value}</strong>
                    <span className="muted" style={{ fontSize: 12, flex: 1, textAlign: "right" }}>{a.basis}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="row" style={{ marginTop: 16 }}>
            <a href={`${import.meta.env.VITE_API_URL ?? "http://localhost:3001"}/plans/${view.plan.id}/export`}>
              Export as Markdown
            </a>
          </div>
        </>
      )}
    </div>
  );
}
