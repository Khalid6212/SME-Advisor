/**
 * Declared operational improvement levers.
 *
 * "Cut three doctors' fixed pay 10%, add a 10% commission above
 * break-even" is a named, costed action, not a growth rate — mirrors
 * RevenueBuild.tsx exactly, for the same reason: the advisor declares a
 * structure (here, a mechanism and a dollar effect by year) and the engine
 * threads it through the P&L faithfully rather than trying to derive it.
 */

import { useEffect, useState } from "react";
import { api, ApiError } from "../api";

interface LeverEffect {
  year_offset: number;
  net_income_effect: number;
}

interface Lever {
  name: string;
  mechanism: string;
  owner: string | null;
  kpi: string | null;
  fy_effects: LeverEffect[];
}

const BLANK: Lever = { name: "", mechanism: "", owner: null, kpi: null, fy_effects: [] };

export function OperationalImprovements({ clientId }: { clientId: string }) {
  const [levers, setLevers] = useState<Lever[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get<{ levers: Lever[] }>(`/clients/${clientId}/operational-improvements`)
      .then((d) => setLevers(d.levers))
      .catch(() => {});
  }, [clientId]);

  const setLever = (i: number, patch: Partial<Lever>) =>
    setLevers((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const addLever = () => setLevers((ls) => [...ls, { ...BLANK, fy_effects: [] }]);
  const removeLever = (i: number) => setLevers((ls) => ls.filter((_, j) => j !== i));

  const setEffect = (i: number, year: number, value: string) => {
    setLevers((ls) =>
      ls.map((l, j) => {
        if (j !== i) return l;
        const rest = l.fy_effects.filter((e) => e.year_offset !== year);
        if (value.trim() === "") return { ...l, fy_effects: rest };
        return { ...l, fy_effects: [...rest, { year_offset: year, net_income_effect: Number(value) || 0 }] };
      }),
    );
  };

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const { levers: next } = await api.put<{ levers: Lever[] }>(`/clients/${clientId}/operational-improvements`, {
        levers: levers
          .filter((l) => l.name.trim() && l.mechanism.trim())
          .map((l) => ({ ...l, owner: l.owner?.trim() || null, kpi: l.kpi?.trim() || null })),
      });
      setLevers(next);
      setSaved(true);
    } catch (e) {
      setError((e as ApiError).message ?? "Could not save the operational improvement levers.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>Operational improvement levers</div>
      <p className="muted" style={{ fontSize: 12, margin: "2px 0 12px" }}>
        A named, specific change to how the business runs, with the dollar effect you declare — this app
        will not try to compute it for you. Each lever's effect flows through EBITDA into net income, cash,
        and the balance sheet, exactly as a real change would.
      </p>

      {levers.map((l, i) => (
        <div key={i} className="card" style={{ marginBottom: 8, padding: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <input
              style={{ flex: 2 }} placeholder="Name — e.g. Pay-cut plus commission"
              value={l.name}
              onChange={(e) => setLever(i, { name: e.target.value })}
            />
            <input
              style={{ flex: 1 }} placeholder="Owner"
              value={l.owner ?? ""}
              onChange={(e) => setLever(i, { owner: e.target.value || null })}
            />
            <input
              style={{ flex: 1 }} placeholder="KPI"
              value={l.kpi ?? ""}
              onChange={(e) => setLever(i, { kpi: e.target.value || null })}
            />
            <button onClick={() => removeLever(i)}>Remove</button>
          </div>

          <input
            style={{ width: "100%", marginTop: 6 }}
            placeholder="Mechanism — what actually changes, in your own words"
            value={l.mechanism}
            onChange={(e) => setLever(i, { mechanism: e.target.value })}
          />

          <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            {[1, 2, 3, 4, 5].map((year) => (
              <div key={year} style={{ flex: 1, minWidth: 90 }}>
                <label className="muted" style={{ fontSize: 11 }}>Year {year} net income effect</label>
                <input
                  type="number" step="any" style={{ width: "100%" }} placeholder="0"
                  value={l.fy_effects.find((e) => e.year_offset === year)?.net_income_effect ?? ""}
                  onChange={(e) => setEffect(i, year, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      <button onClick={addLever}>+ Add lever</button>

      {error && <p style={{ fontSize: 12, color: "var(--bad)" }}>{error}</p>}

      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        <button className="primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save levers"}
        </button>
        {saved && <span className="muted" style={{ fontSize: 12 }}>Saved.</span>}
      </div>
    </div>
  );
}
