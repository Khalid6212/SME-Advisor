import { useEffect, useState } from "react";
import { api, type AgentPerformance, type EvalRunSummary } from "../api";

interface Rule {
  id: string;
  text: string;
  scope_agents: string[];
  scope_audiences: string[];
  scope_sectors: string[];
  scope_sections: string[];
  status: string;
  kind: string | null;
  confidence: string | null;
  rationale: string | null;
  occurrences: number;
  proposed_at: string;
}

/** Two shapes, tagged by `kind` — a text edit to a drafted section, or a
 *  manager dismissing a reconciliation finding with a reason. See
 *  distiller.ts / GET /house-rules/:id/source-edits. */
type SourceItem =
  | {
      kind: "edit"; id: string; section_key: string;
      before_text: string; after_text: string; manager_note: string | null; created_at: string;
    }
  | {
      kind: "finding_dismissal"; id: string;
      statement: string; detail: string; dismissed_reason: string; created_at: string;
    };

const CONFIDENCE_PILL: Record<string, string> = { strong: "good", plausible: "info", weak: "grey" };

const AGENT_LABELS: Record<string, string> = {
  "phase.company_market": "Company & market",
  "phase.strategy": "Strategy",
  "phase.operations": "Operations",
  "phase.financial": "Financial plan",
  "phase.investment_case": "Investment case",
  "phase.summary": "Executive summary",
  planner: "Planner (legacy)",
  interview: "Interview",
  review: "Review",
  reconcile: "Reconciliation",
  research: "Market research",
  ledger: "Ledger analyst",
};

function agentLabel(agent: string): string {
  return AGENT_LABELS[agent] ?? agent;
}

function ScopeTags({ rule }: { rule: Rule }) {
  const groups = [
    ["agent", rule.scope_agents],
    ["audience", rule.scope_audiences],
    ["sector", rule.scope_sectors],
    ["section", rule.scope_sections],
  ] as const;
  const tags = groups.flatMap(([label, values]) => values.map((v) => `${label}: ${v}`));
  if (tags.length === 0) return <span className="muted" style={{ fontSize: 12 }}>Applies everywhere</span>;
  return (
    <span className="muted" style={{ fontSize: 12 }}>
      {tags.join(" · ")}
    </span>
  );
}

/**
 * The eval run (4a) plus the always-on production trend (4b), side by side —
 * one place to answer "how are the agents doing and is it improving." The
 * eval suite itself is never triggered from a page load or a timer: running
 * it calls a real drafting model plus a judge model per section, a real,
 * disclosed cost each time, so the button below asks for confirmation first.
 */
function AgentPerformancePanel() {
  const [perf, setPerf] = useState<AgentPerformance | null>(null);
  const [runs, setRuns] = useState<EvalRunSummary[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    void api.get<AgentPerformance>("/agents/performance").then(setPerf);
    void api.get<EvalRunSummary[]>("/eval/runs").then(setRuns);
  };
  useEffect(load, []);

  const runEval = async () => {
    if (!confirm("This calls the real drafting model plus a judge model for every fixture — a real, billed API cost. Run the eval suite now?")) return;
    setRunning(true);
    setError(null);
    try {
      await api.post("/eval/run");
      load();
    } catch {
      setError("Eval run failed — check server logs.");
    }
    setRunning(false);
  };

  return (
    <div>
      <div className="row" style={{ alignItems: "flex-start", marginBottom: 16 }}>
        <p className="muted" style={{ margin: 0, flex: 1 }}>
          Production trend below is passive, from real approvals. Eval history is deliberate —
          a fixture-based test suite run on demand, e.g. before or after a prompt change.
        </p>
        <button className="primary" onClick={runEval} disabled={running}>
          {running ? "Running…" : "Run eval suite"}
        </button>
      </div>
      {error && <p style={{ color: "var(--bad)" }}>{error}</p>}

      <h4 style={{ margin: "0 0 8px" }}>Production trend, per agent</h4>
      {!perf ? (
        <p className="muted">Loading…</p>
      ) : perf.agents.length === 0 ? (
        <div className="card muted">No approved phases or edits recorded yet.</div>
      ) : (
        <div style={{ overflowX: "auto", marginBottom: 24 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                <th style={{ padding: "6px 8px" }}>Agent</th>
                <th style={{ padding: "6px 8px" }}>Avg edit distance</th>
                <th style={{ padding: "6px 8px" }}>Avg rating</th>
                <th style={{ padding: "6px 8px" }}>Approved w/o edit</th>
                <th style={{ padding: "6px 8px" }}>Latest eval scores</th>
              </tr>
            </thead>
            <tbody>
              {perf.agents.map((a) => (
                <tr key={a.agent} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "6px 8px" }}>{agentLabel(a.agent)}</td>
                  <td style={{ padding: "6px 8px" }}>
                    {a.avg_edit_distance !== null ? `${a.avg_edit_distance} (n=${a.edit_count})` : "—"}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    {a.avg_rating !== null ? `${a.avg_rating}/5 (n=${a.rating_count})` : "—"}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    {a.approved_phases > 0
                      ? `${a.approved_without_edit}/${a.approved_phases} (${Math.round((a.approved_without_edit / a.approved_phases) * 100)}%)`
                      : "—"}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    {a.latest_eval
                      ? `grounding ${a.latest_eval.grounding} · depth ${a.latest_eval.depth} · register ${a.latest_eval.register} · consistency ${a.latest_eval.internal_consistency}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h4 style={{ margin: "0 0 8px" }}>Eval run history</h4>
      {!runs ? (
        <p className="muted">Loading…</p>
      ) : runs.length === 0 ? (
        <div className="card muted">No eval runs yet. Use "Run eval suite" above to run the fixtures for the first time.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                <th style={{ padding: "6px 8px" }}>Run</th>
                <th style={{ padding: "6px 8px" }}>Model</th>
                <th style={{ padding: "6px 8px" }}>Fixtures</th>
                <th style={{ padding: "6px 8px" }}>Deterministic pass</th>
                <th style={{ padding: "6px 8px" }}>Triggered by</th>
                <th style={{ padding: "6px 8px" }}>Note</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "6px 8px" }}>{new Date(r.run_at).toLocaleString()}</td>
                  <td style={{ padding: "6px 8px" }}>{r.model}</td>
                  <td style={{ padding: "6px 8px" }}>{r.fixture_count}</td>
                  <td style={{ padding: "6px 8px" }}>{r.deterministic_passed}/{r.fixture_count}</td>
                  <td style={{ padding: "6px 8px" }}>{r.triggered_by_email ?? "CLI"}</td>
                  <td style={{ padding: "6px 8px" }}>{r.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * The human half of the learning loop. The distiller only ever proposes —
 * nothing here takes effect in a drafting prompt until approved, which is
 * what this screen is for.
 */
export function HouseRules() {
  const [view, setView] = useState<"rules" | "performance">("rules");
  const [status, setStatus] = useState<"candidate" | "active">("candidate");
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState<string | null>(null);
  const [sources, setSources] = useState<Record<string, SourceItem[]>>({});

  const load = () => api.get<Rule[]>(`/house-rules?status=${status}`).then(setRules);
  useEffect(() => { setRules(null); void load(); }, [status]);

  const toggleSources = async (ruleId: string) => {
    if (sourcesOpen === ruleId) return setSourcesOpen(null);
    setSourcesOpen(ruleId);
    if (!sources[ruleId]) {
      const rows = await api.get<SourceItem[]>(`/house-rules/${ruleId}/source-edits`);
      setSources((prev) => ({ ...prev, [ruleId]: rows }));
    }
  };

  const act = async (rule: Rule, action: "approve" | "reject" | "retire") => {
    setBusy(rule.id);
    await api.post(`/house-rules/${rule.id}/${action}`);
    await load();
    setBusy(null);
  };

  return (
    <div>
      <div className="row" style={{ gap: 6, marginBottom: 16 }}>
        <button
          onClick={() => setView("rules")}
          style={view === "rules" ? { borderColor: "var(--info)", color: "var(--info)" } : undefined}
        >
          Rules
        </button>
        <button
          onClick={() => setView("performance")}
          style={view === "performance" ? { borderColor: "var(--info)", color: "var(--info)" } : undefined}
        >
          Performance
        </button>
      </div>

      {view === "performance" ? (
        <AgentPerformancePanel />
      ) : (
        <>
      <div className="row" style={{ gap: 6, marginBottom: 16 }}>
        <button
          onClick={() => setStatus("candidate")}
          style={status === "candidate" ? { borderColor: "var(--info)", color: "var(--info)" } : undefined}
        >
          Awaiting review
        </button>
        <button
          onClick={() => setStatus("active")}
          style={status === "active" ? { borderColor: "var(--info)", color: "var(--info)" } : undefined}
        >
          Active
        </button>
      </div>

      {!rules ? (
        <p className="muted">Loading…</p>
      ) : rules.length === 0 ? (
        <div className="card muted">
          {status === "candidate"
            ? "Nothing waiting on review. Candidates appear here after a pattern shows up in your edits."
            : "No active rules yet."}
        </div>
      ) : (
        rules.map((r) => (
          <div key={r.id} className="card">
            <div className="row">
              {r.confidence && (
                <span className={`pill ${CONFIDENCE_PILL[r.confidence] ?? "grey"}`}>{r.confidence}</span>
              )}
              {r.kind && <span className="pill grey">{r.kind.replace(/_/g, " ")}</span>}
              <span className="muted" style={{ fontSize: 12 }}>
                seen {r.occurrences} time{r.occurrences === 1 ? "" : "s"}
              </span>
              <div style={{ flex: 1 }} />
              {status === "candidate" ? (
                <>
                  <button onClick={() => act(r, "reject")} disabled={busy === r.id}>Reject</button>
                  <button className="primary" onClick={() => act(r, "approve")} disabled={busy === r.id}>
                    {busy === r.id ? "…" : "Approve"}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => act(r, "retire")} disabled={busy === r.id}
                  style={{ borderColor: "var(--bad)", color: "var(--bad)" }}
                >
                  {busy === r.id ? "…" : "Retire"}
                </button>
              )}
            </div>

            <p style={{ margin: "10px 0 4px" }}>{r.text}</p>
            {r.rationale && <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>{r.rationale}</p>}
            <ScopeTags rule={r} />

            <div style={{ marginTop: 8 }}>
              <a href="#" onClick={(e) => { e.preventDefault(); void toggleSources(r.id); }}>
                {sourcesOpen === r.id ? "Hide source edits" : "View source edits"}
              </a>
            </div>

            {sourcesOpen === r.id && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
                {!sources[r.id] ? (
                  <p className="muted" style={{ fontSize: 12 }}>Loading…</p>
                ) : (
                  sources[r.id]!.map((s) =>
                    s.kind === "edit" ? (
                      <div key={s.id} style={{ marginBottom: 12, fontSize: 12 }}>
                        <div className="muted">{s.section_key} · {new Date(s.created_at).toLocaleDateString()}</div>
                        {s.manager_note && <p className="dim" style={{ margin: "4px 0", fontStyle: "italic" }}>“{s.manager_note}”</p>}
                        <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
                          <div style={{ flex: 1 }}>
                            <div className="muted">Before</div>
                            <p style={{ whiteSpace: "pre-wrap", margin: "2px 0" }}>{s.before_text}</p>
                          </div>
                          <div style={{ flex: 1 }}>
                            <div className="muted">After</div>
                            <p style={{ whiteSpace: "pre-wrap", margin: "2px 0" }}>{s.after_text}</p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div key={s.id} style={{ marginBottom: 12, fontSize: 12 }}>
                        <div className="muted">Dismissed finding · {new Date(s.created_at).toLocaleDateString()}</div>
                        <div className="row" style={{ alignItems: "flex-start", gap: 12, marginTop: 4 }}>
                          <div style={{ flex: 1 }}>
                            <div className="muted">Agent flagged</div>
                            <p style={{ whiteSpace: "pre-wrap", margin: "2px 0" }}>{s.statement} — {s.detail}</p>
                          </div>
                          <div style={{ flex: 1 }}>
                            <div className="muted">Manager's reason for dismissing</div>
                            <p style={{ whiteSpace: "pre-wrap", margin: "2px 0" }}>{s.dismissed_reason}</p>
                          </div>
                        </div>
                      </div>
                    ),
                  )
                )}
              </div>
            )}
          </div>
        ))
      )}
        </>
      )}
    </div>
  );
}
