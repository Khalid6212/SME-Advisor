import { useEffect, useState } from "react";
import { api, type FinancialLine, type PlanPhase } from "../api";
import { PlanInputs } from "./PlanInputs";

interface Template {
  key: string; name: { en: string }; purpose: string;
  sections: number; needs_input: string[];
}
interface Section {
  id: string; key: string; title_en: string; content: string;
  provenance: { statement: string; source: string; ref: string; confidence_tier: string }[];
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
  phases: PlanPhase[];
}

const PHASE_STATUS_PILL: Record<string, string> = { pending: "grey", drafted: "warn", approved: "good" };
const PHASE_STATUS_LABEL: Record<string, string> = {
  pending: "Not started", drafted: "Drafted — needs approval", approved: "Approved",
};

const CONFIDENCE: Record<string, string> = {
  well_supported: "good", thin: "warn", blocked: "bad",
};

/** Per-statement, five-tier — a finer read on the same idea as CONFIDENCE
 *  above, which is a whole-section self-rating. See src/planner/confidence.ts.
 *  Rendered via the .tier class (styles.css), which maps tier name to color
 *  directly — no lookup table needed here. */

const AUDIENCE_LABEL: Record<string, string> = {
  full: "Full plan", lender: "Lender pack", internal: "Operating plan",
};

const LINE_ITEM_LABEL: Record<string, string> = {
  revenue: "Revenue", cogs: "Cost of goods sold", gross_profit: "Gross profit",
  operating_cost: "Operating costs", ebitda: "EBITDA", depreciation: "Depreciation",
  ebit: "EBIT", interest_expense: "Interest expense", ebt: "Earnings before Zakat",
  zakat: "Zakat (estimated)", net_income: "Net income",
  principal_repayment: "Principal repayment", debt_service: "Total debt service",
  dscr: "Debt service coverage ratio",
  cash_opening: "Opening cash", cf_net_income: "Net income", cf_depreciation: "+ Depreciation",
  cf_working_capital_change: "± Working capital change", cf_operating: "= Cash from operating activities",
  cf_capex: "Capital expenditure", cf_investing: "= Cash from investing activities",
  cf_debt_drawn: "Facility drawn", cf_principal_repaid: "Principal repaid",
  cf_financing: "= Cash from financing activities", cash_closing: "Closing cash",
  bs_cash: "Cash and cash equivalents", bs_receivables: "Accounts receivable", bs_inventory: "Inventory",
  bs_total_current_assets: "Total current assets", bs_net_fixed_assets: "Net fixed assets",
  bs_total_assets: "Total assets", bs_payables: "Accounts payable",
  bs_debt_current: "Current portion of long-term debt", bs_total_current_liabilities: "Total current liabilities",
  bs_debt_longterm: "Long-term debt", bs_total_liabilities: "Total liabilities",
  bs_equity: "Total equity", bs_total_liabilities_and_equity: "Total liabilities and equity",
};
const LINE_ITEM_ORDER = [
  "revenue", "cogs", "gross_profit", "operating_cost", "ebitda",
  "depreciation", "ebit", "interest_expense", "ebt", "zakat", "net_income",
  "principal_repayment", "debt_service", "dscr",
];
const CASH_FLOW_ORDER = [
  "cash_opening", "cf_net_income", "cf_depreciation", "cf_working_capital_change", "cf_operating",
  "cf_capex", "cf_investing", "cf_debt_drawn", "cf_principal_repaid", "cf_financing", "cash_closing",
];
const BALANCE_SHEET_ORDER = [
  "bs_cash", "bs_receivables", "bs_inventory", "bs_total_current_assets",
  "bs_net_fixed_assets", "bs_total_assets",
  "bs_payables", "bs_debt_current", "bs_total_current_liabilities",
  "bs_debt_longterm", "bs_total_liabilities",
  "bs_equity", "bs_total_liabilities_and_equity",
];

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

// DSCR is a ratio, not a currency figure; negatives read as losses, matching
// the accounting-parens convention used in the exported documents.
function fmtFinancial(item: string, v: string | undefined): string {
  if (v == null) return "—";
  const n = Number(v);
  // Postgres's numeric type accepts a literal 'NaN' — a bad upstream
  // computation must never render as that literal text on screen; treated
  // the same as no value.
  if (!Number.isFinite(n)) return "—";
  if (item === "dscr") return `${n.toFixed(2)}x`;
  const abs = Math.abs(n).toLocaleString();
  return n < 0 ? `(${abs})` : abs;
}

function YearsByItemTable({ rows, order }: { rows: FinancialLine[]; order: string[] }) {
  const years = [...new Set(rows.map((r) => r.year_offset))].sort((a, b) => a - b);
  const items = order.filter((item) => rows.some((r) => r.line_item === item));
  const byKey = new Map(rows.map((r) => [`${r.year_offset}:${r.line_item}`, r.value]));

  return (
    <table className="fin">
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
            {years.map((y) => <td key={y}>{fmtFinancial(item, byKey.get(`${y}:${item}`))}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Four distinct exhibits, not one continuous sheet — matches how the
 *  exported documents present the same data (see api/src/docx.ts). Each
 *  filter positively includes its own line items rather than excluding the
 *  others' — with four disjoint vocabularies sharing one table, an
 *  exclusion filter would silently leak rows between exhibits. */
function FinancialsExhibits({ rows }: { rows: FinancialLine[] }) {
  const base = rows.filter((r) => r.scenario === "base" && LINE_ITEM_ORDER.includes(r.line_item));
  const sensitivity = rows.filter((r) => r.scenario === "bull" || r.scenario === "bear");
  const cashFlow = rows.filter((r) => r.scenario === "base" && CASH_FLOW_ORDER.includes(r.line_item));
  const balanceSheet = rows.filter((r) => r.scenario === "base" && BALANCE_SHEET_ORDER.includes(r.line_item));
  if (base.length === 0 && sensitivity.length === 0 && cashFlow.length === 0 && balanceSheet.length === 0) return null;

  const find = (source: FinancialLine[], scenario: string, item: string, year: number) =>
    source.find((r) => r.scenario === scenario && r.year_offset === year && r.line_item === item)?.value;

  return (
    <>
      {base.length > 0 && (
        <>
          <h2>Income statement</h2>
          <div className="card" style={{ overflowX: "auto" }}>
            <YearsByItemTable rows={base} order={LINE_ITEM_ORDER} />
          </div>
        </>
      )}

      {sensitivity.length > 0 && (() => {
        const year = sensitivity[0]!.year_offset;
        return (
          <>
            <h2>Sensitivity (year {year})</h2>
            <div className="card" style={{ overflowX: "auto" }}>
              <table className="fin">
                <thead><tr><th>Scenario</th><th>Revenue</th><th>EBITDA</th></tr></thead>
                <tbody>
                  <tr>
                    <td>Bear</td>
                    <td>{fmtFinancial("revenue", find(sensitivity, "bear", "revenue", year))}</td>
                    <td>{fmtFinancial("ebitda", find(sensitivity, "bear", "ebitda", year))}</td>
                  </tr>
                  <tr>
                    <td>Base</td>
                    <td>{fmtFinancial("revenue", find(base, "base", "revenue", year))}</td>
                    <td>{fmtFinancial("ebitda", find(base, "base", "ebitda", year))}</td>
                  </tr>
                  <tr>
                    <td>Bull</td>
                    <td>{fmtFinancial("revenue", find(sensitivity, "bull", "revenue", year))}</td>
                    <td>{fmtFinancial("ebitda", find(sensitivity, "bull", "ebitda", year))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        );
      })()}

      {cashFlow.length > 0 && (
        <>
          <h2>Cash flow statement</h2>
          <div className="card" style={{ overflowX: "auto" }}>
            <YearsByItemTable rows={cashFlow} order={CASH_FLOW_ORDER} />
          </div>
        </>
      )}

      {balanceSheet.length > 0 && (
        <>
          <h2>Balance sheet (Statement of Financial Position)</h2>
          <div className="card" style={{ overflowX: "auto" }}>
            <YearsByItemTable rows={balanceSheet} order={BALANCE_SHEET_ORDER} />
          </div>
        </>
      )}
    </>
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
  const [approvingPhase, setApprovingPhase] = useState<string | null>(null);
  const [phaseRating, setPhaseRating] = useState<number | null>(null);
  const [phaseRatingNote, setPhaseRatingNote] = useState("");
  const [chosenOption, setChosenOption] = useState<string | null>(null);
  const [decisionRationale, setDecisionRationale] = useState("");
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);

  const loadList = async () => setPlans(await api.get(`/clients/${clientId}/plans`));
  const loadOutstanding = async () =>
    setOutstanding(await api.get(`/clients/${clientId}/data-room/outstanding`));

  useEffect(() => {
    api.get<Template[]>("/plan-templates").then(setTemplates);
    void loadList();
    void loadOutstanding();
  }, [clientId]);

  const openPlan = async (id: string) => setView(await api.get<PlanView>(`/plans/${id}`));

  // Defaults to whichever phase actually needs attention (the first
  // unlocked, not-yet-approved one) so opening a plan lands somewhere
  // useful — but only when switching to a different plan, not on every
  // refetch after an action, or a manual expand/collapse would keep
  // getting silently reverted mid-review.
  useEffect(() => {
    if (!view) return;
    const ph = view.phases;
    const active = ph.find((p, i) => p.status !== "approved" && (i === 0 || ph[i - 1]!.status === "approved"));
    setExpandedPhase(active?.phase_key ?? null);
  }, [view?.plan.id]);

  const startPlan = async (key: string) => {
    setBusy(key);
    setError(null);
    try {
      const r = await api.post<{ plan_id: string }>(`/clients/${clientId}/plans`, {});
      await loadList();
      await openPlan(r.plan_id);
    } catch (e: any) {
      setError(
        e.code === "no_profile"
          ? "The interview needs to be completed before a plan can be started."
          : e.code === "no_plan_inputs"
            ? "Fill in the planning input below before starting."
            : "Couldn't start a new plan right now.",
      );
      if (e.code === "no_plan_inputs") setShowInputs(true);
    }
    setBusy(null);
  };

  const draftPhase = async (phaseKey: string) => {
    if (!view) return;
    setBusy(phaseKey);
    setError(null);
    try {
      await api.post(`/plans/${view.plan.id}/phases/${phaseKey}/draft`, {});
      await openPlan(view.plan.id);
    } catch (e: any) {
      setError(
        e.code === "previous_phase_not_approved"
          ? "Approve the preceding phase before drafting this one."
          : e.code === "no_plan_inputs"
            ? "Fill in the planning input below before drafting."
            : "The planner is unavailable right now.",
      );
    }
    setBusy(null);
  };

  const approvePhaseAction = async (phaseKey: string) => {
    if (!view) return;
    setBusy(`approve-${phaseKey}`);
    setError(null);
    try {
      await api.post(`/plans/${view.plan.id}/phases/${phaseKey}/approve`, {
        rating: phaseRating,
        rating_note: phaseRatingNote.trim() || undefined,
        chosen_option: chosenOption ?? undefined,
        decision_rationale: decisionRationale.trim() || undefined,
      });
      setApprovingPhase(null);
      setPhaseRating(null);
      setPhaseRatingNote("");
      setChosenOption(null);
      setDecisionRationale("");
      await openPlan(view.plan.id);
    } catch (e: any) {
      setError(
        e.code === "option_required"
          ? "Choose one of the presented options before approving."
          : e.code === "rationale_required"
            ? "Say why, before approving a chosen option."
            : "Couldn't approve this phase — try again.",
      );
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
  const phases = view?.phases ?? [];
  const allPhasesApproved = phases.length > 0 && phases.every((p) => p.status === "approved");
  const isPhaseUnlocked = (phase: PlanPhase) =>
    phase.position === 1 || phases.find((p) => p.position === phase.position - 1)?.status === "approved";

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
            <button key={t.key} onClick={() => startPlan(t.key)} disabled={!!busy} className="primary">
              {busy === t.key ? "Starting…" : `Start new plan`}
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
          One plan, from the profile, the planning input above, and any verified documents —
          drafted one stage at a time below, each reviewed before the next can start. Lender and
          operating views are the same draft, filtered.
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
                  {allPhasesApproved
                    ? "Every phase is approved — approve the plan as a whole before exporting."
                    : "Every phase below needs to be drafted and approved before the plan as a whole can be approved and exported."}
                </p>
                <button className="primary" onClick={approve} disabled={busy === "approve" || !allPhasesApproved}>
                  {busy === "approve" ? "Approving…" : "Approve plan"}
                </button>
              </div>
            )}
            {approved && (
              <div className="row" style={{ marginTop: 10, gap: 16 }}>
                <a href={`${API_BASE}/plans/${view.plan.id}/export?audience=${audience}`}>Export as Markdown</a>
                <a href={`${API_BASE}/plans/${view.plan.id}/export.docx?audience=${audience}`}>Export as Word</a>
                <a href={`${API_BASE}/plans/${view.plan.id}/export.xlsx`}>Export financials as Excel</a>
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

          <h2>Phases</h2>
          <p className="section-sub" style={{ marginTop: -6 }}>
            Click a phase to open it. Collapsed phases show status only, so the whole plan's progress
            fits on one screen.
          </p>
          <div className="stepper">
          {phases.map((phase) => {
            const unlocked = isPhaseUnlocked(phase);
            const phaseSections = visibleSections.filter((s) => phase.section_keys.includes(s.key));
            const isOpen = expandedPhase === phase.phase_key;

            return (
              <div
                key={phase.phase_key} className="card"
                style={{ borderColor: phase.status === "approved" ? "var(--good)" : undefined }}
              >
                <div
                  className="row" style={{ cursor: "pointer" }}
                  onClick={() => setExpandedPhase(isOpen ? null : phase.phase_key)}
                >
                  <span className={`step-marker ${phase.status}`} />
                  <strong style={{ flex: 1 }}>{phase.position}. {phase.title.en}</strong>
                  {phase.rating && <span className="pill info">{phase.rating}/5</span>}
                  <span className={`pill ${PHASE_STATUS_PILL[phase.status]}`}>{PHASE_STATUS_LABEL[phase.status]}</span>
                  <span className="muted" aria-hidden style={{ transform: isOpen ? "rotate(90deg)" : undefined, transition: "transform 0.15s ease", display: "inline-block" }}>
                    ›
                  </span>
                </div>

                {phase.status === "approved" && phase.chosen_option && phase.options_presented && (
                  <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
                    <strong>Decision:</strong>{" "}
                    {phase.options_presented.options.find((o) => o.key === phase.chosen_option)?.label ?? phase.chosen_option}
                    {phase.decision_rationale && <> — "{phase.decision_rationale}"</>}
                  </p>
                )}

                {isOpen && (
                <>
                  {phase.status === "pending" && unlocked && (
                    <div className="row" style={{ marginTop: 10 }}>
                      <button className="primary" onClick={() => draftPhase(phase.phase_key)} disabled={busy === phase.phase_key}>
                        {busy === phase.phase_key ? "Drafting…" : "Draft this phase"}
                      </button>
                    </div>
                  )}
                  {phase.status === "pending" && !unlocked && (
                    <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
                      Approve the preceding phase to unlock this one.
                    </p>
                  )}

                  {phase.status === "drafted" && approvingPhase !== phase.phase_key && (
                    <div className="row" style={{ marginTop: 10 }}>
                      <button onClick={() => draftPhase(phase.phase_key)} disabled={!!busy}>
                        {busy === phase.phase_key ? "Redrafting…" : "Redraft"}
                      </button>
                      <button className="primary" onClick={() => setApprovingPhase(phase.phase_key)}>Approve phase</button>
                    </div>
                  )}
                  {phase.status === "drafted" && approvingPhase === phase.phase_key && (
                    <div className="stack" style={{ marginTop: 10, gap: 8 }}>
                      {phase.options_presented && (
                        <div className="stack" style={{ gap: 8, paddingBottom: 8, borderBottom: "1px solid var(--line)" }}>
                          <strong style={{ fontSize: 13 }}>{phase.options_presented.question}</strong>
                          {phase.options_presented.options.map((o) => (
                            <label
                              key={o.key} className="card" style={{
                                margin: 0, cursor: "pointer", display: "block",
                                borderColor: chosenOption === o.key ? "var(--info)" : undefined,
                              }}
                            >
                              <div className="row">
                                <input
                                  type="radio" name={`options-${phase.phase_key}`} style={{ width: 16 }}
                                  checked={chosenOption === o.key} onChange={() => setChosenOption(o.key)}
                                />
                                <strong>{o.label}</strong>
                              </div>
                              <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
                                <strong>For:</strong> {o.case_for}
                              </p>
                              <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                                <strong>Against:</strong> {o.case_against}
                              </p>
                            </label>
                          ))}
                          <input
                            value={decisionRationale} onChange={(e) => setDecisionRationale(e.target.value)}
                            placeholder="Why this one? (required)"
                          />
                        </div>
                      )}
                      <div className="row" style={{ gap: 6 }}>
                        <span className="muted" style={{ fontSize: 12 }}>Rate this draft (optional):</span>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n} onClick={() => setPhaseRating(phaseRating === n ? null : n)}
                            style={phaseRating === n ? { borderColor: "var(--info)", color: "var(--info)" } : undefined}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      <input
                        value={phaseRatingNote} onChange={(e) => setPhaseRatingNote(e.target.value)}
                        placeholder="Note (optional)"
                      />
                      <div className="row">
                        <button
                          className="primary" onClick={() => approvePhaseAction(phase.phase_key)}
                          disabled={
                            busy === `approve-${phase.phase_key}` ||
                            !!(phase.options_presented && (!chosenOption || !decisionRationale.trim()))
                          }
                        >
                          {busy === `approve-${phase.phase_key}` ? "Approving…" : "Approve phase"}
                        </button>
                        <button
                          onClick={() => {
                            setApprovingPhase(null); setPhaseRating(null); setPhaseRatingNote("");
                            setChosenOption(null); setDecisionRationale("");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {phase.status === "approved" && (
                    <div className="row" style={{ marginTop: 10 }}>
                      <button onClick={() => draftPhase(phase.phase_key)} disabled={!!busy}>
                        {busy === phase.phase_key ? "Redrafting…" : "Redraft (resets later phases)"}
                      </button>
                    </div>
                  )}
                  {error && (busy === phase.phase_key || approvingPhase === phase.phase_key) && (
                    <p style={{ color: "var(--bad)", fontSize: 13, margin: "8px 0 0" }}>{error}</p>
                  )}
                </>
                )}

                {isOpen && phaseSections.map((s) => (
                  <div key={s.id} className="section-block">
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
                        {s.content || <span className="muted">Not drafted yet.</span>}
                      </p>
                    )}

                    {s.provenance?.length > 0 && editing !== s.id && (
                      <details style={{ marginTop: 10 }}>
                        <summary className="muted" style={{ fontSize: 12, cursor: "pointer" }}>
                          {s.provenance.length} sourced statement{s.provenance.length === 1 ? "" : "s"}
                        </summary>
                        {s.provenance.map((p, i) => (
                          <div key={i} className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                            <span className={`tier ${p.confidence_tier}`}>{p.confidence_tier}</span>{" "}
                            <span className="pill grey">{p.source}</span> {p.statement}
                            <span className="dim"> — {p.ref}</span>
                          </div>
                        ))}
                      </details>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
          </div>

          <FinancialsExhibits rows={view.financials} />

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
