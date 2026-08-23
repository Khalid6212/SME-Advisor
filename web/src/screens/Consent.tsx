import { useEffect, useState } from "react";
import { api } from "../api";

type NoticeBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] };

function NoticeView({ blocks }: { blocks: NoticeBlock[] }) {
  return (
    <div dir="auto">
      {blocks.map((b, i) => {
        if (b.type === "heading") {
          return <h3 key={i} style={{ fontSize: 14, margin: i === 0 ? "0 0 10px" : "20px 0 8px" }}>{b.text}</h3>;
        }
        if (b.type === "paragraph") {
          return <p key={i} style={{ fontSize: 13, margin: "0 0 10px" }}>{b.text}</p>;
        }
        if (b.type === "list") {
          return (
            <ul key={i} style={{ margin: "0 0 10px", paddingInlineStart: 20, fontSize: 13 }}>
              {b.items.map((item, j) => <li key={j} style={{ marginBottom: 4 }}>{item}</li>)}
            </ul>
          );
        }
        return (
          <div key={i} style={{ overflowX: "auto", marginBottom: 10 }}>
            <table>
              <thead>
                <tr>{b.headers.map((h, j) => <th key={j}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((row, j) => (
                  <tr key={j}>{row.map((cell, k) => <td key={k} style={{ fontSize: 13 }}>{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

/**
 * A one-time, account-level gate for clients — asked once, before the first
 * interview, rather than re-asked per business. The full notice is generated
 * from the data inventory (src/privacy/notice.ts) so it cannot drift from
 * what the system actually does; this screen adds the short version people
 * will actually read plus the record of agreement.
 */
export function Consent({ onDone }: { onDone: () => void }) {
  const [blocks, setBlocks] = useState<NoticeBlock[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ blocks: NoticeBlock[] }>("/privacy/notice").then((n) => setBlocks(n.blocks)).catch(() => {});
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
          <li>Our AI provider (Anthropic) processes your answers — and any documents you upload — to run the interview, verify what you've told us, and draft your documents. This happens outside the Kingdom.</li>
          <li>Your adviser can see everything you tell us. No one else can.</li>
          <li>We don't ask for documents or certificates at this stage — just questions.</li>
          <li>You can ask us to export or delete your data at any time.</li>
        </ul>

        <button onClick={() => setExpanded(!expanded)} style={{ marginTop: 14 }}>
          {expanded ? "Hide full privacy notice" : "Read the full privacy notice"}
        </button>
        {expanded && (
          <div style={{ marginTop: 12, maxHeight: 400, overflowY: "auto", paddingInlineEnd: 4 }}>
            {blocks ? <NoticeView blocks={blocks} /> : <p className="muted">Loading…</p>}
          </div>
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
