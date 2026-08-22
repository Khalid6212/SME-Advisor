import { useEffect, useState } from "react";
import { api, type PlanInputs as PlanInputsData } from "../api";

const EMPTY: PlanInputsData = {
  revenue_growth_pct: null,
  growth_basis: null,
  projection_years: 3,
  management_assessment: null,
  positioning_notes: null,
  risk_mitigants: null,
  use_of_funds_notes: null,
};

/**
 * The advisor's own judgment, captured before the plan is drafted rather
 * than only added afterward as an edit. This is what lets growth strategy,
 * positioning, and projections be drafted at all — the profile alone cannot
 * ground them (see PLANNER_SYSTEM's "profile is backward-looking" note).
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

  const save = async () => {
    setBusy(true);
    await api.patch(`/clients/${clientId}/plan-inputs`, data);
    setBusy(false);
    setSaved(true);
  };

  if (!loaded) return <p className="muted">Loading…</p>;

  return (
    <div className="card">
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Planning input</div>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Your own judgment — growth, positioning, the team — drafted into the plan directly,
        not added afterward as an edit.
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
