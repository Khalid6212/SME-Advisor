/**
 * The declared revenue build.
 *
 * "Revenue grows 12.9%" is a number a reader can only believe or disbelieve.
 * "Six rooms, eight slots a day, 26 days, 70% utilisation, SAR 1,200 a
 * ticket" is a set of claims they can argue with one at a time — which is the
 * whole point, and why each driver carries its own basis and citation.
 *
 * Drivers are named by the advisor rather than chosen from a list, because
 * the interview already captures how this operator talks about their own
 * business (unit_of_sale, derived_metrics) and a fixed dropdown would throw
 * that away. The formula is plain arithmetic over those names.
 */

import { useEffect, useState } from "react";
import { api, ApiError } from "../api";

interface Driver {
  key: string;
  label: string;
  unit: string | null;
  base_value: number;
  growth_pct: number | null;
  basis: string;
  historical_benchmark: string | null;
  source_code: string | null;
  confidence: "high" | "medium" | "low" | null;
}

interface BuildState {
  revenue_formula: string | null;
  drivers: Driver[];
  check: { unknown: string[]; unused: string[] };
}

const BLANK: Driver = {
  key: "", label: "", unit: null, base_value: 0, growth_pct: null,
  basis: "", historical_benchmark: null, source_code: null, confidence: null,
};

/** Suggests a formula key from the label, so the advisor names the thing once. */
function keyFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "_$1")
    .slice(0, 60);
}

export function RevenueBuild({ clientId }: { clientId: string }) {
  const [state, setState] = useState<BuildState>({ revenue_formula: null, drivers: [], check: { unknown: [], unused: [] } });
  const [formula, setFormula] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get<BuildState>(`/clients/${clientId}/revenue-build`)
      .then((d) => { setState(d); setFormula(d.revenue_formula ?? ""); })
      .catch(() => {});
  }, [clientId]);

  const setDriver = (i: number, patch: Partial<Driver>) =>
    setState((s) => ({ ...s, drivers: s.drivers.map((d, j) => (j === i ? { ...d, ...patch } : d)) }));

  const addDriver = () => setState((s) => ({ ...s, drivers: [...s.drivers, { ...BLANK }] }));
  const removeDriver = (i: number) =>
    setState((s) => ({ ...s, drivers: s.drivers.filter((_, j) => j !== i) }));

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await api.put<BuildState>(`/clients/${clientId}/revenue-build`, {
        revenue_formula: formula.trim() || null,
        drivers: state.drivers
          .filter((d) => d.key.trim() && d.label.trim())
          .map((d) => ({
            ...d,
            base_value: Number(d.base_value) || 0,
            growth_pct: d.growth_pct === null || String(d.growth_pct) === "" ? null : Number(d.growth_pct),
            unit: d.unit?.trim() || null,
            historical_benchmark: d.historical_benchmark?.trim() || null,
            source_code: d.source_code?.trim() || null,
          })),
      });
      setState(next);
      setFormula(next.revenue_formula ?? "");
      setSaved(true);
    } catch (e) {
      setError((e as ApiError).message ?? "Could not save the revenue build.");
    } finally {
      setBusy(false);
    }
  }

  const hasBuild = state.drivers.length > 0 || formula.trim().length > 0;

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>Revenue build</div>
      <p className="muted" style={{ fontSize: 12, margin: "2px 0 12px" }}>
        Declare how this business actually produces revenue, in its own terms. Each driver projects on
        its own and the formula is re-evaluated every year, so utilisation can hold flat while price
        rises. Leave this empty to fall back to a single growth rate.
      </p>

      {state.drivers.map((d, i) => (
        <div key={i} className="card" style={{ marginBottom: 8, padding: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <input
              style={{ flex: 2 }} placeholder="Label — e.g. treatment rooms"
              value={d.label}
              onChange={(e) => {
                const label = e.target.value;
                // Only auto-fill the key while it still matches the label it
                // came from; once the advisor edits it by hand, leave it be —
                // the formula may already reference it.
                const autofilled = !d.key || d.key === keyFromLabel(d.label);
                setDriver(i, autofilled ? { label, key: keyFromLabel(label) } : { label });
              }}
            />
            <input
              style={{ flex: 1, fontFamily: "monospace" }} placeholder="formula name"
              value={d.key}
              onChange={(e) => setDriver(i, { key: e.target.value })}
            />
            <button onClick={() => removeDriver(i)}>Remove</button>
          </div>

          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <div style={{ flex: 1 }}>
              <label className="muted" style={{ fontSize: 11 }}>Today</label>
              <input
                type="number" step="any" style={{ width: "100%" }}
                value={d.base_value}
                onChange={(e) => setDriver(i, { base_value: e.target.value === "" ? 0 : Number(e.target.value) })}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="muted" style={{ fontSize: 11 }}>Unit</label>
              <input
                style={{ width: "100%" }} placeholder="rooms, SAR, %"
                value={d.unit ?? ""}
                onChange={(e) => setDriver(i, { unit: e.target.value || null })}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="muted" style={{ fontSize: 11 }}>Growth %/yr</label>
              <input
                type="number" step="any" style={{ width: "100%" }} placeholder="flat"
                value={d.growth_pct ?? ""}
                onChange={(e) => setDriver(i, { growth_pct: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="muted" style={{ fontSize: 11 }}>Source code</label>
              <input
                style={{ width: "100%" }} placeholder="INT-002"
                value={d.source_code ?? ""}
                onChange={(e) => setDriver(i, { source_code: e.target.value || null })}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="muted" style={{ fontSize: 11 }}>Confidence</label>
              <select
                style={{ width: "100%" }}
                value={d.confidence ?? ""}
                onChange={(e) => setDriver(i, { confidence: (e.target.value || null) as Driver["confidence"] })}
              >
                <option value="">—</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          <input
            style={{ width: "100%", marginTop: 6 }}
            placeholder="Basis — why this value, and why it moves the way it does"
            value={d.basis}
            onChange={(e) => setDriver(i, { basis: e.target.value })}
          />
          <input
            style={{ width: "100%", marginTop: 6 }}
            placeholder="Historically — what this has actually been. Needed whenever the driver grows."
            value={d.historical_benchmark ?? ""}
            onChange={(e) => setDriver(i, { historical_benchmark: e.target.value || null })}
          />
        </div>
      ))}

      <button onClick={addDriver}>+ Add driver</button>

      <label className="muted" style={{ fontSize: 12, display: "block", marginTop: 12 }}>
        Revenue formula
      </label>
      <input
        style={{ width: "100%", marginTop: 4, fontFamily: "monospace" }}
        placeholder="rooms * slots_per_day * working_days * utilisation * avg_ticket"
        value={formula}
        onChange={(e) => setFormula(e.target.value)}
      />
      <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>
        Driver names, numbers, and <code>+ - * / ( )</code>. Nothing else.
        {state.drivers.length > 0 && (
          <> Available: {state.drivers.filter((d) => d.key).map((d) => d.key).join(", ")}</>
        )}
      </p>

      {state.check.unknown.length > 0 && (
        <p style={{ fontSize: 12, color: "var(--bad)" }}>
          The formula names {state.check.unknown.join(", ")}, which {state.check.unknown.length === 1 ? "is not a driver" : "are not drivers"}.
          Revenue will fall back to the growth rate.
        </p>
      )}
      {state.check.unused.length > 0 && (
        <p className="muted" style={{ fontSize: 12 }}>
          Declared but unused in the formula: {state.check.unused.join(", ")}.
        </p>
      )}
      {error && <p style={{ fontSize: 12, color: "var(--bad)" }}>{error}</p>}

      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        <button className="primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : hasBuild ? "Save revenue build" : "Save (no build)"}
        </button>
        {saved && <span className="muted" style={{ fontSize: 12 }}>Saved.</span>}
      </div>
    </div>
  );
}
