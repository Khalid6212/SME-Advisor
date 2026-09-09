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

      <div className="split" style={{ marginTop: 12 }}>
        <div className="mainc">
          {showTranscript ? (
            <div className="chat">
              {view.messages.length === 0
                ? <p className="muted">No messages yet.</p>
                : view.messages.map((m, i) => (
                    <div key={i} className={`bubble ${m.role}`} dir="auto">{m.text}</div>
                  ))}
            </div>
          ) : (
            <div className="card muted">
              Transcript hidden — the claims ledger on the right has every fact the interview
              recorded. Click "Show transcript" above to see the raw conversation it came from.
            </div>
          )}
        </div>

        <div className="rail" style={{ ["--rw" as any]: "320px" }}>
          <div className="card">
            <div className="row" style={{ marginBottom: 2 }}>
              <div style={{ fontWeight: 600, fontSize: 12.5, flex: 1 }}>Claims ledger</div>
              <span className="muted num" style={{ fontSize: 11 }}>{view.claims.length} claims</span>
            </div>
            <p className="muted" style={{ fontSize: 11.5, margin: "0 0 4px" }}>
              Owner-reported facts, editable and verifiable here rather than only visible as
              provenance elsewhere.
            </p>

            {view.claims.length === 0 ? (
              <p className="muted" style={{ fontSize: 12 }}>Nothing recorded yet.</p>
            ) : (
              (["high", "medium", "low"] as const).map((level) =>
                byMateriality[level].length === 0 ? null : (
                  <div key={level}>
                    <div
                      className="muted"
                      style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, margin: "12px 0 4px" }}
                    >
                      {level} materiality
                    </div>
                    {byMateriality[level].map((c) => (
                      <div key={c.id} style={{ paddingTop: 10, marginTop: 10, borderTop: "1px solid var(--line-soft)" }}>
                        <div className="row" style={{ gap: 6 }}>
                          <span className="num muted" style={{ fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {c.field_path}
                          </span>
                          <span className={`pill ${MATERIALITY_PILL[c.materiality]}`}>{c.materiality}</span>
                          <span className={`pill ${VERIFICATION_PILL[c.verification_status]}`}>
                            {c.verification_status}
                          </span>
                        </div>

                        {editing === c.id ? (
                          <div className="stack" style={{ marginTop: 8, gap: 6 }}>
                            <label className="muted" style={{ fontSize: 11 }}>Value</label>
                            <input value={draftValue} onChange={(e) => setDraftValue(e.target.value)} style={{ fontSize: 12.5 }} />
                            <label className="muted" style={{ fontSize: 11 }}>Owner's own words</label>
                            <input value={draftQuote} onChange={(e) => setDraftQuote(e.target.value)} style={{ fontSize: 12.5 }} />
                            <div className="row" style={{ gap: 6 }}>
                              <button className="primary" onClick={() => save(c)} disabled={busy === c.id}>
                                {busy === c.id ? "Saving…" : "Save"}
                              </button>
                              <button onClick={() => setEditing(null)}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="num" style={{ margin: "6px 0 2px", fontSize: 13 }}>
                              {c.stated_value ?? <span className="muted">—</span>}
                            </div>
                            <p className="dim" style={{ fontSize: 11.5, fontStyle: "italic", margin: 0 }}>
                              “{c.owner_quote}”
                            </p>
                            <div className="row" style={{ marginTop: 6, gap: 5, flexWrap: "wrap" }}>
                              <button onClick={() => startEdit(c)} style={{ fontSize: 11.5, padding: "3px 8px" }}>Edit</button>
                              {c.verification_status !== "confirmed" && (
                                <button
                                  disabled={busy === c.id} onClick={() => setVerification(c, "confirmed")}
                                  style={{ fontSize: 11.5, padding: "3px 8px" }}
                                >
                                  Confirm
                                </button>
                              )}
                              {c.verification_status !== "contradicted" && (
                                <button
                                  disabled={busy === c.id} onClick={() => setVerification(c, "contradicted")}
                                  style={{ fontSize: 11.5, padding: "3px 8px" }}
                                >
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
        </div>
      </div>
    </div>
  );
}
