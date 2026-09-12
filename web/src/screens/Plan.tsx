import { useEffect, useState } from "react";
import { api, type FinancialLine, type PlanPhase } from "../api";
import { PlanInputs } from "./PlanInputs";
import { ConfirmDialog } from "../components/ConfirmDialog";

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
  resolved_at: string | null; manager_response: string | null; resolved_by_email: string | null;
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
const PHASE_DOT: Record<string, string> = { pending: "faint", drafted: "warn", approved: "good" };

const CONFIDENCE: Record<string, string> = {
  well_supported: "good", thin: "warn", blocked: "bad",
};

/** Per-statement, five-tier — a finer read on the same idea as CONFIDENCE
 *  above, which is a whole-section self-rating. See src/planner/confidence.ts.
 *  Rendered via the .tier class (styles.css), which maps tier name to color
 *  directly — no lookup table needed here. */

const TIER_ORDER = ["measured", "stated", "estimated", "unverified"] as const;
const TIER_COLOR: Record<string, string> = {
  measured: "var(--gold)", stated: "var(--info)", estimated: "var(--warn)", unverified: "var(--bad)",
};
const TIER_LABEL: Record<string, string> = {
  measured: "Measured", stated: "Stated", estimated: "Estimated", unverified: "Unverified",
};

/** How much of the plan's evidence, across every statement drafted so far,
 *  actually rests on something verified versus the owner's own word — the
 *  same five-tier read the .tier pills already give per-statement (see
 *  confidenceTier in src/planner/confidence.ts), aggregated across the
 *  whole plan. "audited" folds into "measured" here, matching the .tier
 *  CSS's own color grouping — the reader cares about "confirmed by a
 *  document" vs. "stated" vs. "estimated", not the finer distinction. */
function EvidenceMix({ sections }: { sections: Section[] }) {
  const counts: Record<string, number> = {};
  for (const s of sections) {
    for (const p of s.provenance) {
      const key = p.confidence_tier === "audited" ? "measured" : p.confidence_tier;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const present = TIER_ORDER.filter((t) => counts[t]);

  return (
    <div style={{ background: "var(--panel-sunken)", border: "1px solid var(--line-soft)", borderRadius: 14, padding: 14, marginTop: 12 }}>
      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>
        Evidence mix
      </div>
      <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "var(--line)", marginBottom: 10 }}>
        {present.map((t) => (
          <div key={t} style={{ width: `${(counts[t]! / total) * 100}%`, background: TIER_COLOR[t] }} />
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {present.map((t) => (
          <div key={t} className="muted" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: TIER_COLOR[t], flex: "none" }} />
            {TIER_LABEL[t]}
            <span style={{ fontFamily: "var(--mono)", marginInlineStart: "auto" }}>
              {Math.round((counts[t]! / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const AUDIENCE_LABEL: Record<string, string> = {
  full: "Full plan", marketing: "Marketing plan", internal: "Operating plan",
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
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; version: number } | null>(null);
  const [view, setView] = useState<PlanView | null>(null);
  const [audience, setAudience] = useState<"full" | "marketing" | "internal">("full");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [showInputs, setShowInputs] = useState(false);
  const [outstanding, setOutstanding] = useState<{ count: number; items: { title_en: string }[] } | null>(null);
  const [selectedGaps, setSelectedGaps] = useState<Set<string>>(new Set());
  const [gapResponseDrafts, setGapResponseDrafts] = useState<Record<string, string>>({});
  const [approvingPhase, setApprovingPhase] = useState<string | null>(null);
  const [phaseRating, setPhaseRating] = useState<number | null>(null);
  const [phaseRatingNote, setPhaseRatingNote] = useState("");
  const [chosenOption, setChosenOption] = useState<string | null>(null);
  const [decisionRationale, setDecisionRationale] = useState("");
  // Rail selection: either a phase_key or one of the fixed non-phase
  // destinations ("gaps" | "financials" | "assumptions") — replaces the old
  // tab bar + separate expanded-phase state with one selection.
  const [selectedNav, setSelectedNav] = useState<string | null>(null);

  const loadList = async () => setPlans(await api.get(`/clients/${clientId}/plans`));
  const loadOutstanding = async () =>
    setOutstanding(await api.get(`/clients/${clientId}/data-room/outstanding`));

  useEffect(() => {
    api.get<Template[]>("/plan-templates").then(setTemplates);
    void loadList();
    void loadOutstanding();
  }, [clientId]);

  const openPlan = async (id: string) => setView(await api.get<PlanView>(`/plans/${id}`));

  const deletePlan = async () => {
    if (!deleteTarget) return;
    setBusy(`delete-${deleteTarget.id}`);
    setError(null);
    try {
      await api.del(`/plans/${deleteTarget.id}`);
      if (view?.plan.id === deleteTarget.id) setView(null);
      setDeleteTarget(null);
      await loadList();
    } catch {
      setError("Couldn't delete this plan. Try again.");
    }
    setBusy(null);
  };

  // Defaults to whichever phase actually needs attention (the first
  // unlocked, not-yet-approved one) so opening a plan lands somewhere
  // useful — but only when switching to a different plan, not on every
  // refetch after an action, or a manual rail selection would keep
  // getting silently reverted mid-review.
  useEffect(() => {
    if (!view) return;
    const ph = view.phases;
    const active = ph.find((p, i) => p.status !== "approved" && (i === 0 || ph[i - 1]!.status === "approved"));
    setSelectedNav(active?.phase_key ?? ph[0]?.phase_key ?? "gaps");
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

  const resolveGap = async (gapId: string) => {
    const response = (gapResponseDrafts[gapId] ?? "").trim();
    if (!response) return;
    setBusy(`gap-${gapId}`);
    try {
      await api.patch(`/plan-gaps/${gapId}`, { manager_response: response });
      setGapResponseDrafts((prev) => {
        const next = { ...prev };
        delete next[gapId];
        return next;
      });
      if (view) await openPlan(view.plan.id);
    } catch {
      setError("Couldn't save that response — try again.");
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
  const approvedPhaseCount = phases.filter((p) => p.status === "approved").length;
  const openGapsCount = (view?.gaps ?? []).filter((g) => !g.resolved_at).length;
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
            <div key={p.id} className="row" style={{ gap: 2 }}>
              <button onClick={() => openPlan(p.id)}>
                v{p.version} · {p.status === "delivered" ? "approved" : p.status.replace(/_/g, " ")}
              </button>
              <button
                title={`Delete plan v${p.version}`}
                aria-label={`Delete plan v${p.version}`}
                style={{ borderColor: "var(--bad)", color: "var(--bad)", fontSize: 11.5, padding: "3px 8px" }}
                onClick={() => setDeleteTarget({ id: p.id, version: p.version })}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
          One plan, from the profile, the planning input above, and any verified documents —
          drafted one stage at a time below, each reviewed before the next can start. Marketing and
          operating views are the same draft, filtered.
        </p>
        {error && <p style={{ color: "var(--bad)", marginBottom: 0 }}>{error}</p>}
        <ConfirmDialog
          open={!!deleteTarget}
          danger
          title={`Delete plan v${deleteTarget?.version}?`}
          message="This permanently removes this plan version — its drafted sections, financials, assumptions, and gaps — and cannot be undone. Other versions of this client's plan are not affected."
          confirmLabel="Delete permanently"
          busy={busy === `delete-${deleteTarget?.id}`}
          onConfirm={deletePlan}
          onCancel={() => setDeleteTarget(null)}
        />
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
              {(["full", "marketing", "internal"] as const).map((a) => (
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

          <p className="section-sub" style={{ margin: "26px 0 12px" }}>
            {approvedPhaseCount}/{phases.length} phases approved. Pick a phase, or jump to gaps,
            financials, or assumptions below.
          </p>

          <div className="split">
            <div className="rail" style={{ ["--rw" as any]: "236px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {phases.map((phase) => (
                  <button
                    key={phase.phase_key}
                    className={`prow${selectedNav === phase.phase_key ? " on" : ""}`}
                    onClick={() => setSelectedNav(phase.phase_key)}
                  >
                    <span className="num" style={{ fontSize: 11, color: "var(--faint)", flex: "none" }}>
                      {String(phase.position).padStart(2, "0")}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {phase.title.en}
                    </span>
                    <span className="dot" style={{ background: `var(--${PHASE_DOT[phase.status]})` }} />
                  </button>
                ))}
                <div style={{ borderTop: "1px solid var(--line)", margin: "8px 4px" }} />
                <button className={`prow${selectedNav === "gaps" ? " on" : ""}`} onClick={() => setSelectedNav("gaps")}>
                  <span style={{ flex: 1 }}>Gaps</span>
                  {openGapsCount > 0 && <span className="num" style={{ fontSize: 11, color: "var(--faint)" }}>{openGapsCount}</span>}
                </button>
                <button className={`prow${selectedNav === "financials" ? " on" : ""}`} onClick={() => setSelectedNav("financials")}>
                  Financials
                </button>
                <button className={`prow${selectedNav === "assumptions" ? " on" : ""}`} onClick={() => setSelectedNav("assumptions")}>
                  <span style={{ flex: 1 }}>Assumptions</span>
                  {view.assumptions.length > 0 && <span className="num" style={{ fontSize: 11, color: "var(--faint)" }}>{view.assumptions.length}</span>}
                </button>
              </div>
              <EvidenceMix sections={view.sections} />
            </div>

            <div className="mainc">
          {selectedNav === "gaps" && (() => {
            const openGaps = view.gaps.filter((g) => !g.resolved_at);
            const resolvedGaps = view.gaps.filter((g) => g.resolved_at);
            return (
              <>
                {openGaps.length === 0 ? (
                  <div className="card muted">No open gaps — every section either has what it needs or hasn't been drafted yet.</div>
                ) : (
                  <>
                    {selectedGaps.size > 0 && (
                      <div className="row" style={{ marginBottom: 12 }}>
                        <div style={{ flex: 1 }} />
                        <button className="primary" onClick={sendGapRequests} disabled={busy === "gaps"}>
                          {busy === "gaps"
                            ? "Sending…"
                            : `Send ${selectedGaps.size} question${selectedGaps.size === 1 ? "" : "s"} in one email`}
                        </button>
                      </div>
                    )}
                    <div className="card" style={{ padding: 4, overflowX: "auto" }}>
                      <table>
                        <thead>
                          <tr>
                            <th></th>
                            <th>Section</th>
                            <th>Question</th>
                            <th>Status</th>
                            <th>Response</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {openGaps.map((g) => (
                            <tr key={g.id}>
                              <td>
                                {!g.request_id && (
                                  <input
                                    type="checkbox" style={{ width: 16 }}
                                    checked={selectedGaps.has(g.id)}
                                    onChange={() => toggleGap(g.id)}
                                  />
                                )}
                              </td>
                              <td className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{g.section_key}</td>
                              <td style={{ minWidth: 220 }}>
                                <div>{g.question}</div>
                                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{g.why_it_matters}</div>
                              </td>
                              <td style={{ whiteSpace: "nowrap" }}>
                                <span className={`pill ${g.blocking ? "bad" : "grey"}`}>
                                  {g.blocking ? "blocking" : "optional"}
                                </span>
                                {g.request_id && <span className="pill info" style={{ marginLeft: 6 }}>requested</span>}
                              </td>
                              <td style={{ minWidth: 220 }}>
                                <textarea
                                  rows={1}
                                  value={gapResponseDrafts[g.id] ?? ""}
                                  onChange={(e) => {
                                    setGapResponseDrafts((prev) => ({ ...prev, [g.id]: e.target.value }));
                                    e.target.style.height = "auto";
                                    e.target.style.height = `${e.target.scrollHeight}px`;
                                  }}
                                  placeholder="Answer directly — a call with the client, something you already know"
                                  style={{ width: "100%", resize: "vertical", overflow: "hidden", fontFamily: "inherit" }}
                                />
                              </td>
                              <td>
                                <button
                                  className="primary" onClick={() => resolveGap(g.id)}
                                  disabled={busy === `gap-${g.id}` || !(gapResponseDrafts[g.id] ?? "").trim()}
                                >
                                  {busy === `gap-${g.id}` ? "Saving…" : "Save"}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {resolvedGaps.length > 0 && (
                  <details style={{ marginTop: 16 }}>
                    <summary className="muted" style={{ cursor: "pointer" }}>
                      {resolvedGaps.length} resolved
                    </summary>
                    <div className="card" style={{ padding: 4, marginTop: 10, overflowX: "auto" }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Section</th>
                            <th>Question</th>
                            <th>Response</th>
                            <th>Resolved by</th>
                          </tr>
                        </thead>
                        <tbody>
                          {resolvedGaps.map((g) => (
                            <tr key={g.id}>
                              <td className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{g.section_key}</td>
                              <td>{g.question}</td>
                              <td className="muted" style={{ fontStyle: "italic" }}>{g.manager_response}</td>
                              <td className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{g.resolved_by_email ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </>
            );
          })()}

          {selectedNav === "financials" && (
            view.financials.length === 0 ? (
              <div className="card muted">No financial statements computed yet — these appear once the financial phase is drafted.</div>
            ) : (
              <FinancialsExhibits rows={view.financials} />
            )
          )}

          {selectedNav === "assumptions" && (
            view.assumptions.length === 0 ? (
              <div className="card muted">No forward-looking assumptions recorded yet.</div>
            ) : (
              <div className="card">
                {view.assumptions.map((a, i) => (
                  <div key={i} className="row" style={{ borderTop: i ? "1px solid var(--line)" : undefined, padding: "8px 0" }}>
                    <span style={{ flex: 1 }}>{a.label}</span>
                    <strong>{a.value}</strong>
                    <span className="muted" style={{ fontSize: 12, flex: 1, textAlign: "right" }}>{a.basis}</span>
                  </div>
                ))}
              </div>
            )
          )}

          {(() => {
            const phase = phases.find((p) => p.phase_key === selectedNav);
            if (!phase) return null;
            const unlocked = isPhaseUnlocked(phase);
            const phaseSections = visibleSections.filter((s) => phase.section_keys.includes(s.key));
            const phaseGaps = view.gaps.filter((g) => phase.section_keys.includes(g.section_key) && !g.resolved_at);

            return (
              <div className="card" style={{ padding: "22px 26px 18px" }}>
                <div className="row" style={{ marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                  <span className="muted" style={{ fontSize: 11.5 }}>Phase {phase.position}</span>
                  <h2 style={{ margin: 0, flex: 1, minWidth: 0 }}>{phase.title.en}</h2>
                  {phase.rating && <span className="pill info">{phase.rating}/5</span>}
                  <span className={`pill ${PHASE_STATUS_PILL[phase.status]}`}>{PHASE_STATUS_LABEL[phase.status]}</span>
                </div>

                {phase.status === "approved" && phase.chosen_option && phase.options_presented && (
                  <p className="muted" style={{ fontSize: 12, margin: "0 0 14px" }}>
                    <strong>Decision:</strong>{" "}
                    {phase.options_presented.options.find((o) => o.key === phase.chosen_option)?.label ?? phase.chosen_option}
                    {phase.decision_rationale && <> — "{phase.decision_rationale}"</>}
                  </p>
                )}

                {phase.status === "pending" && unlocked && (
                  <div className="row">
                    <button className="primary" onClick={() => draftPhase(phase.phase_key)} disabled={busy === phase.phase_key}>
                      {busy === phase.phase_key ? "Drafting…" : "Draft this phase"}
                    </button>
                  </div>
                )}
                {phase.status === "pending" && !unlocked && (
                  <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                    Approve the preceding phase to unlock this one.
                  </p>
                )}

                {phase.status === "drafted" && approvingPhase !== phase.phase_key && (
                  <div className="row">
                    <button onClick={() => draftPhase(phase.phase_key)} disabled={!!busy}>
                      {busy === phase.phase_key ? "Redrafting…" : "Redraft"}
                    </button>
                    <button className="primary" onClick={() => setApprovingPhase(phase.phase_key)}>Approve phase</button>
                  </div>
                )}
                {phase.status === "drafted" && approvingPhase === phase.phase_key && (
                  <div className="stack" style={{ gap: 8 }}>
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
                  <div className="row">
                    <button onClick={() => draftPhase(phase.phase_key)} disabled={!!busy}>
                      {busy === phase.phase_key ? "Redrafting…" : "Redraft (resets later phases)"}
                    </button>
                  </div>
                )}
                {error && (busy === phase.phase_key || approvingPhase === phase.phase_key) && (
                  <p style={{ color: "var(--bad)", fontSize: 13, margin: "8px 0 0" }}>{error}</p>
                )}

                {phaseGaps.length > 0 && (
                  <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--line-soft)" }}>
                    <a href="#" onClick={(e) => { e.preventDefault(); setSelectedNav("gaps"); }} style={{ fontSize: 12 }}>
                      {phaseGaps.length} open gap{phaseGaps.length === 1 ? "" : "s"} in this phase
                    </a>
                  </div>
                )}

                {phaseSections.map((s) => (
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
          })()}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
