import { useEffect, useState } from "react";
import { api, type ClientFact, type Fact, type Finding } from "../api";

const SOURCE_LABEL: Record<string, string> = { ledger: "Ledger analysis", extract: "Document extraction" };

const SEVERITY_PILL: Record<string, string> = { critical: "bad", high: "warn", medium: "info", low: "grey" };
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
  const [allFacts, setAllFacts] = useState<ClientFact[] | null>(null);
  const [factsSectionOpen, setFactsSectionOpen] = useState(false);
  const [editingFact, setEditingFact] = useState<string | null>(null);
  const [factDraft, setFactDraft] = useState<{ value: string; quote: string }>({ value: "", quote: "" });
  const [factBusy, setFactBusy] = useState<string | null>(null);

  const load = () => api.get<Finding[]>(`/clients/${clientId}/findings`).then(setFindings);
  useEffect(() => { setFindings(null); void load(); }, [clientId]);

  const loadAllFacts = async () => {
    if (allFacts) return;
    setAllFacts(await api.get<ClientFact[]>(`/clients/${clientId}/facts`));
  };

  const startEditFact = (f: ClientFact) => {
    setEditingFact(f.id);
    setFactDraft({ value: f.value, quote: f.quote });
  };

  const saveFact = async (factId: string) => {
    setFactBusy(factId);
    try {
      await api.patch(`/facts/${factId}`, factDraft);
      setEditingFact(null);
      setAllFacts(await api.get<ClientFact[]>(`/clients/${clientId}/facts`));
    } finally {
      setFactBusy(null);
    }
  };

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
          <div key={f.id} className="card" style={{ display: "flex", gap: 14 }}>
            <div className={`stripe ${f.severity}`} />
            <div style={{ flex: 1, minWidth: 0 }}>
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

      <details style={{ marginTop: 16 }} onToggle={(e) => { if (e.currentTarget.open) { setFactsSectionOpen(true); void loadAllFacts(); } }}>
        <summary className="muted" style={{ cursor: "pointer" }}>
          All extracted &amp; computed facts
        </summary>
        {factsSectionOpen && (
          !allFacts ? (
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Loading…</p>
          ) : allFacts.length === 0 ? (
            <div className="card muted" style={{ marginTop: 10 }}>Nothing extracted or computed yet.</div>
          ) : (
            <div className="card" style={{ padding: 4, marginTop: 10, overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Value</th>
                    <th>Quote</th>
                    <th>Source</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {allFacts.map((f) => (
                    <tr key={f.id}>
                      <td className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                        {f.key}{f.period ? ` · ${f.period}` : ""}
                      </td>
                      {editingFact === f.id ? (
                        <>
                          <td style={{ minWidth: 140 }}>
                            <input
                              value={factDraft.value}
                              onChange={(e) => setFactDraft((prev) => ({ ...prev, value: e.target.value }))}
                            />
                          </td>
                          <td style={{ minWidth: 220 }}>
                            <input
                              value={factDraft.quote}
                              onChange={(e) => setFactDraft((prev) => ({ ...prev, quote: e.target.value }))}
                            />
                          </td>
                          <td className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                            {SOURCE_LABEL[f.source_agent] ?? f.source_agent}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <button
                              className="primary" onClick={() => saveFact(f.id)}
                              disabled={factBusy === f.id || !factDraft.value.trim() || !factDraft.quote.trim()}
                            >
                              {factBusy === f.id ? "Saving…" : "Save"}
                            </button>
                            <button onClick={() => setEditingFact(null)} disabled={factBusy === f.id}>Cancel</button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td>{f.value}{f.unit ? ` ${f.unit}` : ""}{f.edited_at && <span className="pill grey" style={{ marginLeft: 6 }}>edited</span>}</td>
                          <td className="dim" style={{ fontStyle: "italic" }}>"{f.quote}"</td>
                          <td className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                            {SOURCE_LABEL[f.source_agent] ?? f.source_agent} · {f.filename}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <button onClick={() => startEditFact(f)}>Correct</button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </details>
    </div>
  );
}
