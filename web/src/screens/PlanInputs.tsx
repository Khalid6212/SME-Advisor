import { useEffect, useState } from "react";
import { api, type CompetitorNote, type PlanInputs as PlanInputsData } from "../api";

const EMPTY: PlanInputsData = {
  revenue_growth_pct: null,
  growth_basis: null,
  projection_years: 3,
  management_assessment: null,
  positioning_notes: null,
  risk_mitigants: null,
  use_of_funds_notes: null,
  loan_term_years: null,
  loan_interest_rate_pct: null,
  asset_useful_life_years: null,
  market_size_tam: null,
  market_size_sam: null,
  market_size_som: null,
  market_size_sources: null,
  market_growth_pct: null,
  market_drivers_notes: null,
  competitor_notes: [],
  exit_strategy_notes: null,
  unit_economics_notes: null,
};

/**
 * The advisor's own judgment, captured before the plan is drafted rather
 * than only added afterward as an edit. This is what lets growth strategy,
 * positioning, market analysis, competitive landscape, and exit strategy be
 * drafted at all — the profile alone cannot ground them (see PLANNER_SYSTEM's
 * "profile is backward-looking" note), and the planner is forbidden from
 * inventing market statistics or a competitor's weaknesses on its own.
 */
export function PlanInputs({ clientId }: { clientId: string }) {
  const [data, setData] = useState<PlanInputsData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get<PlanInputsData | null>(`/clients/${clientId}/plan-inputs`).then((d) => {
      if (d) setData(d);
      setLoaded(true);
    });
  }, [clientId]);

  const set = <K extends keyof PlanInputsData>(key: K, value: PlanInputsData[K]) => {
    setSaved(false);
    setData((prev) => ({ ...prev, [key]: value }));
  };

  const setCompetitor = (i: number, field: keyof CompetitorNote, value: string) => {
    setSaved(false);
    setData((prev) => {
      const next = [...prev.competitor_notes];
      next[i] = { ...next[i]!, [field]: value };
      return { ...prev, competitor_notes: next };
    });
  };

  const addCompetitor = () => {
    setSaved(false);
    setData((prev) => ({
      ...prev,
      competitor_notes: [...prev.competitor_notes, { name: "", strengths: "", weaknesses: "" }],
    }));
  };

  const removeCompetitor = (i: number) => {
    setSaved(false);
    setData((prev) => ({ ...prev, competitor_notes: prev.competitor_notes.filter((_, j) => j !== i) }));
  };

  const save = async () => {
    setBusy(true);
    await api.patch(`/clients/${clientId}/plan-inputs`, {
      ...data,
      competitor_notes: data.competitor_notes.filter((c) => c.name.trim()),
    });
    setBusy(false);
    setSaved(true);
  };

  if (!loaded) return <p className="muted">Loading…</p>;

  return (
    <div className="card">
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Planning input</div>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Your own judgment and research — growth, market sizing, competitors, the team, exit —
        drafted into the plan directly, not added afterward as an edit.
      </p>

      <div className="stack" style={{ gap: 12, marginTop: 12 }}>
        <div className="row" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label className="muted" style={{ fontSize: 12 }}>Annual revenue growth assumption (%)</label>
            <input
              type="number" step="0.1" style={{ width: "100%", marginTop: 4 }}
              value={data.revenue_growth_pct ?? ""}
              onChange={(e) => set("revenue_growth_pct", e.target.value === "" ? null : Number(e.target.value))}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label className="muted" style={{ fontSize: 12 }}>Projection years</label>
            <input
              type="number" min={1} max={10} style={{ width: "100%", marginTop: 4 }}
              value={data.projection_years}
              onChange={(e) => set("projection_years", Math.max(1, Math.min(10, Number(e.target.value) || 3)))}
            />
          </div>
        </div>

        <div>
          <label className="muted" style={{ fontSize: 12 }}>Basis for the growth assumption</label>
          <textarea
            rows={2} style={{ width: "100%", marginTop: 4 }}
            placeholder="e.g. new location opening in Q2, contracted volume increase already signed"
            value={data.growth_basis ?? ""}
            onChange={(e) => set("growth_basis", e.target.value || null)}
          />
        </div>

        <div>
          <label className="muted" style={{ fontSize: 12 }}>Management assessment</label>
          <textarea
            rows={2} style={{ width: "100%", marginTop: 4 }}
            placeholder="Your read on the team — depth, gaps, succession"
            value={data.management_assessment ?? ""}
            onChange={(e) => set("management_assessment", e.target.value || null)}
          />
        </div>

        <div>
          <label className="muted" style={{ fontSize: 12 }}>Positioning notes</label>
          <textarea
            rows={2} style={{ width: "100%", marginTop: 4 }}
            placeholder="How this business actually competes — your judgment, not the owner's self-report"
            value={data.positioning_notes ?? ""}
            onChange={(e) => set("positioning_notes", e.target.value || null)}
          />
        </div>

        <div>
          <label className="muted" style={{ fontSize: 12 }}>Risk mitigants</label>
          <textarea
            rows={2} style={{ width: "100%", marginTop: 4 }}
            placeholder="Mitigants you know about beyond what the owner stated"
            value={data.risk_mitigants ?? ""}
            onChange={(e) => set("risk_mitigants", e.target.value || null)}
          />
        </div>

        <div>
          <label className="muted" style={{ fontSize: 12 }}>Use-of-funds notes</label>
          <textarea
            rows={2} style={{ width: "100%", marginTop: 4 }}
            value={data.use_of_funds_notes ?? ""}
            onChange={(e) => set("use_of_funds_notes", e.target.value || null)}
          />
        </div>

        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Facility assumptions</div>
          <p className="muted" style={{ fontSize: 12, margin: "2px 0 8px" }}>
            Illustrative only, for the debt-service projection — not a lender-quoted term.
          </p>
          <div className="row" style={{ gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="muted" style={{ fontSize: 12 }}>Loan term (years)</label>
              <input
                type="number" min={1} max={30} style={{ width: "100%", marginTop: 4 }}
                value={data.loan_term_years ?? ""}
                onChange={(e) => set("loan_term_years", e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="muted" style={{ fontSize: 12 }}>Interest rate (%)</label>
              <input
                type="number" step="0.1" min={0} max={50} style={{ width: "100%", marginTop: 4 }}
                value={data.loan_interest_rate_pct ?? ""}
                onChange={(e) => set("loan_interest_rate_pct", e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="muted" style={{ fontSize: 12 }}>Asset useful life (years)</label>
              <input
                type="number" min={1} max={30} style={{ width: "100%", marginTop: 4 }}
                value={data.asset_useful_life_years ?? ""}
                onChange={(e) => set("asset_useful_life_years", e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Market sizing</div>
          <p className="muted" style={{ fontSize: 12, margin: "2px 0 8px" }}>
            Your own research, with a source — the planner may not estimate a market size on its own.
          </p>
          <div className="row" style={{ gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="muted" style={{ fontSize: 12 }}>TAM (SAR)</label>
              <input
                type="number" style={{ width: "100%", marginTop: 4 }}
                value={data.market_size_tam ?? ""}
                onChange={(e) => set("market_size_tam", e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="muted" style={{ fontSize: 12 }}>SAM (SAR)</label>
              <input
                type="number" style={{ width: "100%", marginTop: 4 }}
                value={data.market_size_sam ?? ""}
                onChange={(e) => set("market_size_sam", e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="muted" style={{ fontSize: 12 }}>SOM (SAR)</label>
              <input
                type="number" style={{ width: "100%", marginTop: 4 }}
                value={data.market_size_som ?? ""}
                onChange={(e) => set("market_size_som", e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="muted" style={{ fontSize: 12 }}>Market growth (%/yr)</label>
              <input
                type="number" step="0.1" style={{ width: "100%", marginTop: 4 }}
                value={data.market_growth_pct ?? ""}
                onChange={(e) => set("market_growth_pct", e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
          </div>
          <label className="muted" style={{ fontSize: 12, display: "block", marginTop: 8 }}>Sources</label>
          <input
            style={{ width: "100%", marginTop: 4 }}
            placeholder="e.g. KPMG Healthcare Report 2025; national statistics agency"
            value={data.market_size_sources ?? ""}
            onChange={(e) => set("market_size_sources", e.target.value || null)}
          />
          <label className="muted" style={{ fontSize: 12, display: "block", marginTop: 8 }}>Growth drivers</label>
          <textarea
            rows={2} style={{ width: "100%", marginTop: 4 }}
            placeholder="Why the market is growing — regulation, demographics, policy"
            value={data.market_drivers_notes ?? ""}
            onChange={(e) => set("market_drivers_notes", e.target.value || null)}
          />
        </div>

        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Competitive landscape</div>
          <p className="muted" style={{ fontSize: 12, margin: "2px 0 8px" }}>
            Your own assessment of named competitors — the owner's view of a rival's weaknesses is
            not a reliable source.
          </p>
          {data.competitor_notes.map((c, i) => (
            <div key={i} className="card" style={{ marginBottom: 8, padding: 12 }}>
              <div className="row" style={{ gap: 8 }}>
                <input
                  style={{ flex: 1 }} placeholder="Competitor name"
                  value={c.name} onChange={(e) => setCompetitor(i, "name", e.target.value)}
                />
                <button onClick={() => removeCompetitor(i)}>Remove</button>
              </div>
              <input
                style={{ width: "100%", marginTop: 6 }} placeholder="Strengths"
                value={c.strengths} onChange={(e) => setCompetitor(i, "strengths", e.target.value)}
              />
              <input
                style={{ width: "100%", marginTop: 6 }} placeholder="Weaknesses"
                value={c.weaknesses} onChange={(e) => setCompetitor(i, "weaknesses", e.target.value)}
              />
            </div>
          ))}
          <button onClick={addCompetitor}>+ Add competitor</button>
        </div>

        <div>
          <label className="muted" style={{ fontSize: 12 }}>Unit economics</label>
          <textarea
            rows={2} style={{ width: "100%", marginTop: 4 }}
            placeholder="For a multi-location or asset-heavy business: how one unit performs and what it costs to add another. Leave blank if not applicable."
            value={data.unit_economics_notes ?? ""}
            onChange={(e) => set("unit_economics_notes", e.target.value || null)}
          />
        </div>

        <div>
          <label className="muted" style={{ fontSize: 12 }}>Exit strategy</label>
          <textarea
            rows={2} style={{ width: "100%", marginTop: 4 }}
            placeholder="Likely pathways and any comparable transactions you know of. Leave blank for a straightforward bank facility."
            value={data.exit_strategy_notes ?? ""}
            onChange={(e) => set("exit_strategy_notes", e.target.value || null)}
          />
        </div>

        <div className="row">
          <button className="primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save planning input"}
          </button>
          {saved && <span className="muted" style={{ fontSize: 12 }}>Saved.</span>}
        </div>
      </div>
    </div>
  );
}
