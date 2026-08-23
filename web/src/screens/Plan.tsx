import { useEffect, useState } from "react";
import { api, type FinancialLine } from "../api";
import { PlanInputs } from "./PlanInputs";

interface Template {
  key: string; name: { en: string }; purpose: string;
  sections: number; needs_input: string[];
}
interface Section {
  id: string; key: string; title_en: string; content: string;
  provenance: { statement: string; source: string; ref: string }[];
  confidence: string | null; status: string; audiences: string[];
}
interface Gap {
  id: string; section_key: string; question: string;
  why_it_matters: string; blocking: boolean; request_id: string | null;
}
interface PlanView {
  plan: {
    id: string; version: number; status: string; readiness: string | null;
    manager_note: string | null; template_key: string; profile_superseded: boolean;
    approved_by: string | null; approved_at: string | null;
  };
  sections: Section[];
  assumptions: { label: string; value: string; basis: string }[];
  gaps: Gap[];
  financials: FinancialLine[];
}

const CONFIDENCE: Record<string, string> = {
  well_supported: "good", thin: "warn", blocked: "bad",
};

const AUDIENCE_LABEL: Record<string, string> = {
  full: "Full plan", lender: "Lender pack", internal: "Operating plan",
};

const LINE_ITEM_LABEL: Record<string, string> = {
  revenue: "Revenue", cogs: "Cost of goods sold", gross_profit: "Gross profit",
  operating_cost: "Operating costs", ebitda: "EBITDA", depreciation: "Depreciation",
  ebit: "EBIT", interest_expense: "Interest expense", net_income: "Net income",
  principal_repayment: "Principal repayment", debt_service: "Total debt service",
  dscr: "Debt service coverage ratio",
};
const LINE_ITEM_ORDER = [
  "revenue", "cogs", "gross_profit", "operating_cost", "ebitda",
  "depreciation", "ebit", "interest_expense", "net_income",
  "principal_repayment", "debt_service", "dscr",
];

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

function FinancialsTable({ rows }: { rows: FinancialLine[] }) {
  if (rows.length === 0) return null;
  const years = [...new Set(rows.map((r) => r.year_offset))].sort((a, b) => a - b);
  const items = LINE_ITEM_ORDER.filter((item) => rows.some((r) => r.line_item === item));
  const byKey = new Map(rows.map((r) => [`${r.year_offset}:${r.line_item}`, r.value]));
  // DSCR is a ratio, not a currency figure; negatives read as losses, matching
  // the accounting-parens convention used in the exported documents.
  const fmt = (item: string, v: string | undefined) => {
    if (v == null) return "—";
    const n = Number(v);
    if (item === "dscr") return `${n.toFixed(2)}x`;
    const abs = Math.abs(n).toLocaleString();
    return n < 0 ? `(${abs})` : abs;
  };

  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            <th>SAR</th>
            {years.map((y) => <th key={y}>{y === 0 ? "Base year" : `Year ${y}`}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item}>
              <td>{LINE_ITEM_LABEL[item] ?? item}</td>
              {years.map((y) => <td key={y}>{fmt(item, byKey.get(`${y}:${item}`))}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Plan({ clientId }: { clientId: string }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [plans, setPlans] = useState<{ id: string; version: number; status: string }[]>([]);
  const [view, setView] = useState<PlanView | null>(null);
  const [audience, setAudience] = useState<"full" | "lender" | "internal">("full");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [showInputs, setShowInputs] = useState(false);
  const [outstanding, setOutstanding] = useState<{ count: number; items: { title_en: string }[] } | null>(null);
  const [selectedGaps, setSelectedGaps] = useState<Set<string>>(new Set());

  const loadList = async () => setPlans(await api.get(`/clients/${clientId}/plans`));
  const loadOutstanding = async () =>
    setOutstanding(await api.get(`/clients/${clientId}/data-room/outstanding`));

  useEffect(() => {
    api.get<Template[]>("/plan-templates").then(setTemplates);
    void loadList();
    void loadOutstanding();
  }, [clientId]);

  const openPlan = async (id: string) => setView(await api.get<PlanView>(`/plans/${id}`));

  const generate = async (key: string) => {
    setBusy(key);
    setError(null);
    try {
      const r = await api.post<{ plan_id: string }>(`/clients/${clientId}/plans`, {});
      await loadList();
      await openPlan(r.plan_id);
    } catch (e: any) {
      setError(
        e.code === "no_profile"
          ? "The interview needs to be completed before a plan can be drafted."
          : e.code === "no_plan_inputs"
            ? "Fill in the planning input below before drafting."
            : "The planner is unavailable right now.",
      );
      if (e.code === "no_plan_inputs") setShowInputs(true);
    }
    setBusy(null);
  };

  const approve = async () => {
    if (!view) return;
    setBusy("approve");
    await api.post(`/plans/${view.plan.id}/approve`);
    await openPlan(view.plan.id);
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

  const toggleGap = (id: string) => {
    setSelectedGaps((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const sendGapRequests = async () => {
    setBusy("gaps");
    try {
      await api.post("/plan-gaps/request-batch", { gap_ids: [...selectedGaps] });
      setSelectedGaps(new Set());
      if (view) await openPlan(view.plan.id);
    } catch {
      setError("Couldn't send that — try again.");
    }
    setBusy(null);
  };

  const remindOutstanding = async () => {
    setBusy("remind");
    try {
      await api.post(`/clients/${clientId}/data-room/remind`, {});
      await loadOutstanding();
    } catch {
      setError("Couldn't send the reminder — try again.");
    }
    setBusy(null);
  };

  const approved = view?.plan.status === "delivered";
  const visibleSections = (view?.sections ?? []).filter(
    (s) => audience === "full" || s.audiences.includes(audience),
  );

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button onClick={() => setShowInputs(!showInputs)}>
          {showInputs ? "Hide planning input" : "Planning input"}
        </button>
      </div>
      {showInputs && <div style={{ marginBottom: 16 }}><PlanInputs clientId={clientId} /></div>}

      {outstanding && outstanding.count > 0 && (
        <div className="card" style={{ borderColor: "var(--warn)", marginBottom: 16 }}>
          <div className="row">
            <div style={{ flex: 1 }}>
              <strong>{outstanding.count} requested document{outstanding.count === 1 ? "" : "s"} not yet uploaded</strong>
              <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                {outstanding.items.map((i) => i.title_en).join(", ")}
              </p>
            </div>
            <button onClick={remindOutstanding} disabled={busy === "remind"}>
              {busy === "remind" ? "Sending…" : "Send reminder"}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {templates.map((t) => (
            <button key={t.key} onClick={() => generate(t.key)} disabled={!!busy} className="primary">
              {busy === t.key ? "Drafting…" : `Draft business plan`}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          {plans.map((p) => (
            <button key={p.id} onClick={() => openPlan(p.id)}>
              v{p.version} · {p.status === "delivered" ? "approved" : p.status.replace(/_/g, " ")}
            </button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
          One plan, drafted once from the profile, the planning input above, and any verified
          documents. Lender and operating views are the same draft, filtered.
        </p>
        {error && <p style={{ color: "var(--bad)", marginBottom: 0 }}>{error}</p>}
      </div>

      {!view ? null : (
        <>
          <div className="card">
            <div className="row">
              <span className={`pill ${approved ? "good" : "grey"}`}>
                {approved ? "Approved" : view.plan.status.replace(/_/g, " ")}
              </span>
              {view.plan.readiness && <span className="pill info">{view.plan.readiness.replace(/_/g, " ")}</span>}
              <div style={{ flex: 1 }} />
              {(["full", "lender", "internal"] as const).map((a) => (
                <button
                  key={a} onClick={() => setAudience(a)}
                  style={audience === a ? { borderColor: "var(--info)", color: "var(--info)" } : undefined}
                >
                  {AUDIENCE_LABEL[a]}
                </button>
              ))}
            </div>
            {!approved && (
              <div className="row" style={{ marginTop: 10 }}>
                <p className="muted" style={{ fontSize: 12, flex: 1, margin: 0 }}>
                  Approve before exporting — the formatted export is only available once a
                  manager has explicitly signed off on this version.
                </p>
                <button className="primary" onClick={approve} disabled={busy === "approve"}>
                  {busy === "approve" ? "Approving…" : "Approve plan"}
                </button>
              </div>
            )}
            {approved && (
              <div className="row" style={{ marginTop: 10, gap: 16 }}>
                <a href={`${API_BASE}/plans/${view.plan.id}/export?audience=${audience}`}>Export as Markdown</a>
                <a href={`${API_BASE}/plans/${view.plan.id}/export.docx?audience=${audience}`}>Export as Word</a>
              </div>
            )}
          </div>

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
              <div className="row">
                <h2 style={{ flex: 1 }}>Gaps ({view.gaps.length})</h2>
                {selectedGaps.size > 0 && (
                  <button className="primary" onClick={sendGapRequests} disabled={busy === "gaps"}>
                    {busy === "gaps"
                      ? "Sending…"
                      : `Send ${selectedGaps.size} question${selectedGaps.size === 1 ? "" : "s"} in one email`}
                  </button>
                )}
              </div>
              {view.gaps.map((g) => (
                <div key={g.id} className="card">
                  <div className="row">
                    {!g.request_id && (
                      <input
                        type="checkbox" style={{ width: 16 }}
                        checked={selectedGaps.has(g.id)}
                        onChange={() => toggleGap(g.id)}
                      />
                    )}
                    <span className={`pill ${g.blocking ? "bad" : "grey"}`}>
                      {g.blocking ? "blocking" : "optional"}
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>{g.section_key}</span>
                    <div style={{ flex: 1 }} />
                    {g.request_id && <span className="pill info">requested</span>}
                  </div>
                  <p style={{ margin: "8px 0 4px" }}>{g.question}</p>
                  <p className="muted" style={{ fontSize: 12, margin: 0 }}>{g.why_it_matters}</p>
                </div>
              ))}
            </>
          )}

          <h2>Sections</h2>
          {visibleSections.map((s) => (
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
                  {approved && (
                    <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                      Saving will revoke this plan's approval — it will need re-approving before it can be exported again.
                    </p>
                  )}
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

          {view.financials.length > 0 && (
            <>
              <h2>Financial projections</h2>
              <FinancialsTable rows={view.financials} />
            </>
          )}

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
        </>
      )}
    </div>
  );
}
