import { useEffect, useState } from "react";
import { api, type Fact, type Finding } from "../api";

const SEVERITY_PILL: Record<string, string> = { critical: "bad", high: "warn", medium: "info", low: "grey" };
/** A colored left edge reads as severity faster than the pill alone —
 *  matches the stripe language used everywhere severity/status appears. */
const SEVERITY_EDGE: Record<string, string> = {
  critical: "var(--bad)", high: "var(--warn)", medium: "var(--info)", low: "var(--faint)",
};
const TYPE_LABEL: Record<string, string> = {
  contradiction: "Contradiction",
  trend_break: "Trend break",
  concentration: "Concentration",
  anomaly: "Anomaly",
  missing_evidence: "Missing evidence",
};
const RAISED_BY_LABEL: Record<string, string> = {
  reconciliation_agent: "Reconciliation",
  pattern_engine: "Pattern check",
};

/**
 * What the deterministic pattern engine and the reconciliation agent raise
 * from a client's evidence — proactive, not just whatever a document happened
 * to be asked to verify. Proposals only, same spirit as house rules: nothing
 * here changes a plan on its own, though an open finding is also shown to the
 * drafting agent (see planner.ts's openFindings) so it doesn't silently pick
 * a side while a contradiction is still unresolved.
 */
export function Findings({ clientId }: { clientId: string }) {
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [factsOpen, setFactsOpen] = useState<string | null>(null);
  const [facts, setFacts] = useState<Record<string, Fact[]>>({});
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState("");

  const load = () => api.get<Finding[]>(`/clients/${clientId}/findings`).then(setFindings);
  useEffect(() => { setFindings(null); void load(); }, [clientId]);

  const toggleFacts = async (findingId: string) => {
    if (factsOpen === findingId) return setFactsOpen(null);
    setFactsOpen(findingId);
    if (!facts[findingId]) {
      const rows = await api.get<Fact[]>(`/findings/${findingId}/facts`);
      setFacts((prev) => ({ ...prev, [findingId]: rows }));
    }
  };

  const act = async (finding: Finding, status: "acknowledged" | "resolved" | "dismissed", reason?: string) => {
    setBusy(finding.id);
    await api.patch(`/findings/${finding.id}`, { status, dismissed_reason: reason });
    setDismissing(null);
    setDismissReason("");
    await load();
    setBusy(null);
  };

  const open = (findings ?? []).filter((f) => f.status === "open" || f.status === "acknowledged");
  const settled = (findings ?? []).filter((f) => f.status === "resolved" || f.status === "dismissed");

  return (
    <div>
      {!findings ? (
        <p className="muted">Loading…</p>
      ) : open.length === 0 ? (
        <div className="card muted">
          Nothing open. Every uploaded document is checked against the client's other documents and
          claims automatically — this stays empty until something disagrees.
        </div>
      ) : (
        open.map((f) => (
          <div key={f.id} className="card" style={{ borderLeft: `3px solid ${SEVERITY_EDGE[f.severity] ?? "var(--faint)"}` }}>
            <div className="row">
              <span className={`pill ${SEVERITY_PILL[f.severity] ?? "grey"}`}>{f.severity}</span>
              <span className="pill grey">{TYPE_LABEL[f.type] ?? f.type}</span>
              <span className="muted" style={{ fontSize: 12 }}>{RAISED_BY_LABEL[f.raised_by] ?? f.raised_by}</span>
              {f.status === "acknowledged" && <span className="pill info">Acknowledged</span>}
              <div style={{ flex: 1 }} />
              {dismissing !== f.id && (
                <>
                  {f.status === "open" && (
                    <button onClick={() => act(f, "acknowledged")} disabled={busy === f.id}>Acknowledge</button>
                  )}
                  <button onClick={() => setDismissing(f.id)} disabled={busy === f.id}>Dismiss</button>
                  <button className="primary" onClick={() => act(f, "resolved")} disabled={busy === f.id}>
                    {busy === f.id ? "…" : "Resolve"}
                  </button>
                </>
              )}
            </div>

            <p style={{ margin: "10px 0 4px" }}>{f.statement}</p>
            <p className="muted" style={{ fontSize: 13, whiteSpace: "pre-wrap", margin: "0 0 8px" }}>{f.detail}</p>

            {dismissing === f.id && (
              <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                <input
                  value={dismissReason} onChange={(e) => setDismissReason(e.target.value)}
                  placeholder="Why dismiss this? (required)"
                />
                <div className="row">
                  <button
                    className="primary" onClick={() => act(f, "dismissed", dismissReason.trim())}
                    disabled={busy === f.id || !dismissReason.trim()}
                    style={{ borderColor: "var(--bad)", color: "var(--bad)" }}
                  >
                    {busy === f.id ? "…" : "Confirm dismiss"}
                  </button>
                  <button onClick={() => { setDismissing(null); setDismissReason(""); }}>Cancel</button>
                </div>
              </div>
            )}

            {f.supporting_fact_ids.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <a href="#" onClick={(e) => { e.preventDefault(); void toggleFacts(f.id); }}>
                  {factsOpen === f.id ? "Hide supporting facts" : `${f.supporting_fact_ids.length} supporting fact${f.supporting_fact_ids.length === 1 ? "" : "s"}`}
                </a>
                {factsOpen === f.id && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
                    {!facts[f.id] ? (
                      <p className="muted" style={{ fontSize: 12 }}>Loading…</p>
                    ) : (
                      facts[f.id]!.map((fact) => (
                        <div key={fact.id} className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                          <span className="pill grey">{fact.key}{fact.period ? ` · ${fact.period}` : ""}</span>{" "}
                          {fact.value}{fact.unit ? ` ${fact.unit}` : ""} — "{fact.quote}"
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))
      )}

      {settled.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary className="muted" style={{ cursor: "pointer" }}>
            {settled.length} resolved or dismissed
          </summary>
          {settled.map((f) => (
            <div key={f.id} className="card" style={{ marginTop: 10, opacity: 0.7 }}>
              <div className="row">
                <span className={`pill ${SEVERITY_PILL[f.severity] ?? "grey"}`}>{f.severity}</span>
                <span className="pill grey">{f.status}</span>
              </div>
              <p style={{ margin: "10px 0 0" }}>{f.statement}</p>
              {f.dismissed_reason && (
                <p className="muted" style={{ fontSize: 12, margin: "4px 0 0", fontStyle: "italic" }}>
                  "{f.dismissed_reason}"
                </p>
              )}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
