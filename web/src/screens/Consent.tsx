import { useEffect, useState } from "react";
import { api } from "../api";

/**
 * A one-time, account-level gate for clients — asked once, before the first
 * interview, rather than re-asked per business. The full notice is generated
 * from the data inventory (src/privacy/notice.ts) so it cannot drift from
 * what the system actually does; this screen adds the short version people
 * will actually read plus the record of agreement.
 */
export function Consent({ onDone }: { onDone: () => void }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ text: string }>("/privacy/notice").then((n) => setNotice(n.text)).catch(() => {});
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/me/privacy/consents", { purpose: "interview_data_processing" });
      onDone();
    } catch {
      setError("Something went wrong. Try again.");
      setBusy(false);
    }
  };

  return (
    <div className="shell" style={{ maxWidth: 640 }}>
      <h1>Before we start</h1>
      <p className="sub">A short, honest note on how your answers are used.</p>

      <div className="card">
        <ul style={{ margin: 0, paddingInlineStart: 20, lineHeight: 1.7 }}>
          <li>Your answers are stored in Saudi Arabia and used to prepare your investment-readiness assessment.</li>
          <li>Our AI provider (Anthropic) processes your answers to run the interview and draft documents — this happens outside the Kingdom, under a data processing agreement.</li>
          <li>Your investment adviser can see everything you tell us. No one else can.</li>
          <li>We don't ask for documents or certificates at this stage — just questions.</li>
          <li>You can ask us to export or delete your data at any time.</li>
        </ul>

        <button onClick={() => setExpanded(!expanded)} style={{ marginTop: 14 }}>
          {expanded ? "Hide full privacy notice" : "Read the full privacy notice"}
        </button>
        {expanded && (
          <pre
            dir="auto"
            style={{
              whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, marginTop: 12,
              maxHeight: 320, overflowY: "auto", paddingInlineEnd: 4,
            }}
          >
            {notice ?? "Loading…"}
          </pre>
        )}

        <label className="row" style={{ marginTop: 18, gap: 8, alignItems: "flex-start" }}>
          <input
            type="checkbox" checked={agreed} style={{ marginTop: 3 }}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>I've read this and agree to my answers being used as described.</span>
        </label>

        {error && <p style={{ color: "var(--bad)", fontSize: 13 }}>{error}</p>}
        <button className="primary" style={{ marginTop: 12 }} disabled={!agreed || busy} onClick={submit}>
          {busy ? "Saving…" : "Agree and continue"}
        </button>
      </div>
    </div>
  );
}
