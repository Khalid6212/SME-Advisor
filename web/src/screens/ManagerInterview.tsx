import { useEffect, useState } from "react";
import { api, type Claim, type InterviewSummary } from "../api";

const LABELS: Record<string, string> = {
  business_identity: "Identity",
  revenue_and_customers: "Revenue",
  financial_health: "Financials",
  operations: "Ops",
  market_position: "Market",
  funding_need: "Funding",
  financial_records: "Records",
};
const ORDER = Object.keys(LABELS);
const MATERIALITY_PILL: Record<string, string> = { high: "bad", medium: "warn", low: "grey" };
const VERIFICATION_PILL: Record<string, string> = { confirmed: "good", contradicted: "bad", unverified: "grey" };

/**
 * The manager-side counterpart to the client's Interview screen: a summary,
 * the raw transcript on demand, and the owner-reported claims — editable here
 * rather than only visible as provenance elsewhere in the app.
 */
export function ManagerInterview({ clientId }: { clientId: string }) {
  const [view, setView] = useState<InterviewSummary | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [draftQuote, setDraftQuote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => api.get<InterviewSummary>(`/clients/${clientId}/interview`).then(setView);
  useEffect(() => { void load(); }, [clientId]);

  const startEdit = (c: Claim) => {
    setEditing(c.id);
    setDraftValue(c.stated_value ?? "");
    setDraftQuote(c.owner_quote);
  };

  const save = async (c: Claim) => {
    setBusy(c.id);
    await api.patch(`/claims/${c.id}`, { stated_value: draftValue || null, owner_quote: draftQuote });
    setEditing(null);
    await load();
    setBusy(null);
  };

  const setVerification = async (c: Claim, status: string) => {
    setBusy(c.id);
    await api.patch(`/claims/${c.id}`, { verification_status: status });
    await load();
    setBusy(null);
  };

  if (!view) return <p className="muted">Loading…</p>;

  const done = view.sections.filter((s) => s.complete).length;
  const byMateriality: Record<"high" | "medium" | "low", Claim[]> = { high: [], medium: [], low: [] };
  for (const c of view.claims) byMateriality[c.materiality].push(c);

  const exportBase = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

  return (
    <div>
      <div className="card">
        <div className="row">
          <div style={{ flex: 1 }}>
            <strong>{done} of {ORDER.length} sections complete</strong>
            {view.profile?.readiness && (
              <span className="pill info" style={{ marginInlineStart: 10 }}>
                {view.profile.readiness.replace(/_/g, " ")}
              </span>
            )}
          </div>
          <span className="pill grey">{view.status.replace(/_/g, " ")}</span>
        </div>
        <div className="row" style={{ gap: 4, marginTop: 10 }}>
          {ORDER.map((id) => {
            const s = view.sections.find((x) => x.section_id === id);
            const colour = !s ? "var(--line)" : s.complete ? "var(--good)" : "var(--warn)";
            return (
              <div key={id} style={{ flex: 1 }} title={LABELS[id]}>
                <div style={{ height: 3, background: colour, borderRadius: 2 }} />
              </div>
            );
          })}
        </div>
        <div className="row" style={{ marginTop: 14, gap: 12 }}>
          <a href={`${exportBase}/clients/${clientId}/interview/export.docx`}>Download summary (Word)</a>
          <div style={{ flex: 1 }} />
          <button onClick={() => setShowTranscript(!showTranscript)}>
            {showTranscript ? "Hide transcript" : "Show transcript"}
          </button>
        </div>
      </div>

      {showTranscript && (
        <div className="chat" style={{ marginBottom: 16 }}>
          {view.messages.length === 0
            ? <p className="muted">No messages yet.</p>
            : view.messages.map((m, i) => (
                <div key={i} className={`bubble ${m.role}`} dir="auto">{m.text}</div>
              ))}
        </div>
      )}

      <h2>Raw answers</h2>
      {view.claims.length === 0 ? (
        <div className="card muted">Nothing recorded yet.</div>
      ) : (
        (["high", "medium", "low"] as const).map((level) =>
          byMateriality[level].length === 0 ? null : (
            <div key={level}>
              <div
                className="muted"
                style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, margin: "14px 0 6px" }}
              >
                {level} materiality
              </div>
              {byMateriality[level].map((c) => (
                <div key={c.id} className="card">
                  <div className="row">
                    <strong style={{ flex: 1 }}>{c.field_path}</strong>
                    <span className={`pill ${MATERIALITY_PILL[c.materiality]}`}>{c.materiality}</span>
                    <span className={`pill ${VERIFICATION_PILL[c.verification_status]}`}>
                      {c.verification_status}
                    </span>
                  </div>

                  {editing === c.id ? (
                    <div className="stack" style={{ marginTop: 10 }}>
                      <label className="muted" style={{ fontSize: 12 }}>Value</label>
                      <input value={draftValue} onChange={(e) => setDraftValue(e.target.value)} />
                      <label className="muted" style={{ fontSize: 12 }}>Owner's own words</label>
                      <input value={draftQuote} onChange={(e) => setDraftQuote(e.target.value)} />
                      <div className="row">
                        <button className="primary" onClick={() => save(c)} disabled={busy === c.id}>
                          {busy === c.id ? "Saving…" : "Save"}
                        </button>
                        <button onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p style={{ margin: "8px 0 4px" }}>
                        {c.stated_value ?? <span className="muted">—</span>}
                      </p>
                      <p className="dim" style={{ fontSize: 12, fontStyle: "italic", margin: 0 }}>
                        “{c.owner_quote}”
                      </p>
                      <div className="row" style={{ marginTop: 8, gap: 6 }}>
                        <button onClick={() => startEdit(c)}>Edit</button>
                        {c.verification_status !== "confirmed" && (
                          <button disabled={busy === c.id} onClick={() => setVerification(c, "confirmed")}>
                            Confirm
                          </button>
                        )}
                        {c.verification_status !== "contradicted" && (
                          <button disabled={busy === c.id} onClick={() => setVerification(c, "contradicted")}>
                            Flag contradicted
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ),
        )
      )}
    </div>
  );
}
