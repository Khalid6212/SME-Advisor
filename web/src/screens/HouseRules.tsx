import { useEffect, useState } from "react";
import { api } from "../api";

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

interface SourceEdit {
  id: string;
  section_key: string;
  before_text: string;
  after_text: string;
  manager_note: string | null;
  created_at: string;
}

const CONFIDENCE_PILL: Record<string, string> = { strong: "good", plausible: "info", weak: "grey" };

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
 * The human half of the learning loop. The distiller only ever proposes —
 * nothing here takes effect in a drafting prompt until approved, which is
 * what this screen is for.
 */
export function HouseRules() {
  const [status, setStatus] = useState<"candidate" | "active">("candidate");
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState<string | null>(null);
  const [sources, setSources] = useState<Record<string, SourceEdit[]>>({});

  const load = () => api.get<Rule[]>(`/house-rules?status=${status}`).then(setRules);
  useEffect(() => { setRules(null); void load(); }, [status]);

  const toggleSources = async (ruleId: string) => {
    if (sourcesOpen === ruleId) return setSourcesOpen(null);
    setSourcesOpen(ruleId);
    if (!sources[ruleId]) {
      const rows = await api.get<SourceEdit[]>(`/house-rules/${ruleId}/source-edits`);
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
                  sources[r.id]!.map((s) => (
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
                  ))
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
