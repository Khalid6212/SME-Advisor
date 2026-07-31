// GENERATED FILE — do not edit.
// Built from src/core and src/sectors by scripts/build-prototype.mjs.
// Edit the source and re-run `npm run build:prototype`.
//
// Phase 1 throwaway prototype. Runs in the Claude artifact sandbox, which
// injects API auth and provides window.storage. It will NOT run anywhere else.
//
// It exists to answer one question: does the _general pack produce genuinely
// operator-shaped derived metrics across unrelated businesses, or generic ones?

import { useState, useEffect, useRef } from "react";

const BUILD = __BUILD_META__;
const MODEL = __MODEL__;
const SYSTEM_PROMPT = __SYSTEM_PROMPT__;
const TOOLS = __TOOLS__;
const SECTION_ORDER = __SECTION_ORDER__;

const SECTION_LABELS = {
  business_identity: "Business identity",
  revenue_and_customers: "Revenue & customers",
  financial_health: "Financial health",
  operations: "Operations",
  market_position: "Market position",
  funding_need: "Funding need",
  financial_records: "Financial records",
};

const C = {
  bg: "#11111b", panel: "#1e1e2e", line: "#313244", text: "#cdd6f4",
  dim: "#a6adc8", faint: "#6c7086", accent: "#1a5c3a", good: "#a6e3a1",
  info: "#89b4fa", warn: "#f9e2af",
};

const STORAGE_KEY = "sme-advisor-prototype-v1";

async function loadState() {
  try {
    const r = await window.storage.get(STORAGE_KEY);
    return r ? JSON.parse(r.value) : null;
  } catch { return null; }
}

async function saveState(state) {
  try { await window.storage.set(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { console.error("storage failed", e); }
}

// ─── agent loop ─────────────────────────────────────────────────────────────

async function callClaude(messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/**
 * Run turns until the model stops calling tools.
 *
 * save_section is acknowledged and the draft is merged. submit_profile ends the
 * interview — that is the completion signal, not a parsed JSON fence.
 */
async function runTurn(messages, onSection, onSubmit) {
  let history = [...messages];

  for (let i = 0; i < 8; i++) {
    const res = await callClaude(history);
    history.push({ role: "assistant", content: res.content });

    const toolUses = res.content.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) return { history, done: false };

    const results = [];
    for (const call of toolUses) {
      if (call.name === "save_section") {
        onSection(call.input);
        results.push({
          type: "tool_result", tool_use_id: call.id,
          content: `Saved ${call.input.section_id}.`,
        });
      } else if (call.name === "submit_profile") {
        onSubmit(call.input);
        return { history, done: true };
      } else {
        results.push({
          type: "tool_result", tool_use_id: call.id,
          content: `Unknown tool ${call.name}.`, is_error: true,
        });
      }
    }
    history.push({ role: "user", content: results });
  }
  return { history, done: false };
}

// ─── components ─────────────────────────────────────────────────────────────

function Bubble({ role, text }) {
  const mine = role === "user";
  return (
    <div style={{
      display: "flex", justifyContent: mine ? "flex-end" : "flex-start",
      marginBottom: 12, paddingLeft: mine ? 48 : 0, paddingRight: mine ? 0 : 48,
    }}>
      <div dir="auto" style={{
        background: mine ? C.accent : C.panel,
        color: mine ? "#e8f5e9" : C.text,
        border: mine ? "none" : `1px solid ${C.line}`,
        padding: "12px 16px", fontSize: 14, lineHeight: 1.65,
        whiteSpace: "pre-wrap", maxWidth: "100%",
        borderRadius: mine ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
      }}>{text}</div>
    </div>
  );
}

function Progress({ saved }) {
  return (
    <div style={{
      display: "flex", gap: 4, padding: "10px 16px",
      borderBottom: `1px solid ${C.line}`, background: C.bg, flexShrink: 0,
    }}>
      {SECTION_ORDER.map((id) => {
        const s = saved[id];
        const color = !s ? C.line : s.complete ? C.good : C.warn;
        return (
          <div key={id} title={SECTION_LABELS[id]} style={{ flex: 1 }}>
            <div style={{ height: 3, background: color, borderRadius: 2 }} />
            <div style={{ fontSize: 9, color: C.faint, marginTop: 4, textAlign: "center" }}>
              {SECTION_LABELS[id].split(" ")[0]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Results({ result, onReset }) {
  const profile = result?.profile ?? {};
  const claims = result?.claims ?? [];
  const sector = profile.sector_detail ?? {};
  const metrics = sector.derived_metrics ?? [];
  const [tab, setTab] = useState("metrics");

  const copy = () => navigator.clipboard?.writeText(JSON.stringify(result, null, 2));

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
      <div style={{
        padding: 16, marginBottom: 20, background: "#1a5c3a22",
        border: `1px solid #1a5c3a55`, borderRadius: 12,
      }}>
        <div style={{ color: C.good, fontWeight: 600, marginBottom: 6 }}>
          ✓ Interview complete
        </div>
        <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.5 }}>
          This is the experiment's output. Read the derived metrics below — are they
          specific to how this business actually operates, in the owner's own words?
          Or are they generic ("monthly revenue", "number of customers")?
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {["metrics", "claims", "json"].map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "6px 14px", borderRadius: 8, cursor: "pointer",
            border: `1px solid ${tab === t ? C.info : C.line}`,
            background: tab === t ? "#89b4fa22" : "transparent",
            color: tab === t ? C.info : C.faint, fontSize: 12, fontWeight: 600,
            textTransform: "capitalize",
          }}>{t}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={copy} style={{
          padding: "6px 14px", borderRadius: 8, border: `1px solid ${C.line}`,
          background: "transparent", color: C.dim, fontSize: 12, cursor: "pointer",
        }}>Copy JSON</button>
        <button onClick={onReset} style={{
          padding: "6px 14px", borderRadius: 8, border: `1px solid ${C.line}`,
          background: "transparent", color: C.faint, fontSize: 12, cursor: "pointer",
        }}>New interview</button>
      </div>

      {tab === "metrics" && (
        <div>
          <Field label="Inferred business model" value={sector.inferred_business_model} />
          <Field label="Unit of sale" value={sector.unit_of_sale} />
          <div style={{ color: C.faint, fontSize: 11, textTransform: "uppercase",
                        letterSpacing: 1, margin: "20px 0 8px" }}>
            Derived metrics ({metrics.length})
          </div>
          {metrics.length === 0 && (
            <div style={{ color: C.warn, fontSize: 13 }}>
              None recorded — the probe mechanism did not fire. That is a finding.
            </div>
          )}
          {metrics.map((m, i) => (
            <div key={i} style={{
              background: C.panel, border: `1px solid ${C.line}`,
              borderRadius: 10, padding: 14, marginBottom: 8,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>
                  {m.metric_name}
                </span>
                <span style={{ color: C.good, fontSize: 14, whiteSpace: "nowrap" }}>
                  {m.value ?? "—"} {m.unit ?? ""}
                </span>
              </div>
              <div dir="auto" style={{ color: C.dim, fontSize: 12, marginTop: 8, fontStyle: "italic" }}>
                "{m.question_asked}"
              </div>
              <div style={{ color: C.faint, fontSize: 12, marginTop: 6 }}>
                {m.why_it_matters}
              </div>
            </div>
          ))}
          {sector.sector_notes_for_reviewer && (
            <Field label="Notes for reviewer" value={sector.sector_notes_for_reviewer} />
          )}
        </div>
      )}

      {tab === "claims" && (
        <div>
          <div style={{ color: C.faint, fontSize: 12, marginBottom: 12 }}>
            {claims.filter((c) => c.materiality === "high").length} high-materiality
            of {claims.length} total. These drive the verification agent's document request.
          </div>
          {claims.map((c, i) => (
            <div key={i} style={{
              background: C.panel, border: `1px solid ${C.line}`,
              borderRadius: 10, padding: 12, marginBottom: 6, fontSize: 13,
            }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{
                  fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 700,
                  background: c.materiality === "high" ? "#f38ba822" : "#6c708622",
                  color: c.materiality === "high" ? "#f38ba8" : C.faint,
                  textTransform: "uppercase",
                }}>{c.materiality}</span>
                <span style={{ color: C.dim, fontFamily: "monospace", fontSize: 11 }}>
                  {c.field_path}
                </span>
                <div style={{ flex: 1 }} />
                <span style={{ color: C.text }}>{String(c.stated_value ?? "—")}</span>
              </div>
              <div dir="auto" style={{ color: C.faint, fontSize: 12, marginTop: 6, fontStyle: "italic" }}>
                "{c.owner_quote}"
              </div>
              <div style={{ color: C.info, fontSize: 11, marginTop: 4 }}>
                verify via {c.verifiable_by?.join(", ")}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "json" && (
        <pre style={{
          color: C.text, fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap",
          wordBreak: "break-word", background: C.panel, padding: 16,
          borderRadius: 10, border: `1px solid ${C.line}`,
        }}>{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}

function Field({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ color: C.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>
        {label}
      </div>
      <div dir="auto" style={{ color: C.text, fontSize: 14, marginTop: 4, lineHeight: 1.5 }}>
        {value}
      </div>
    </div>
  );
}

// ─── app ────────────────────────────────────────────────────────────────────

export default function App() {
  const [messages, setMessages] = useState([]);
  const [saved, setSaved] = useState({});
  const [result, setResult] = useState(null);
  const [input, setInput] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const bottom = useRef(null);

  useEffect(() => {
    loadState().then((s) => {
      if (s) { setMessages(s.messages ?? []); setSaved(s.saved ?? {}); setResult(s.result ?? null); }
      setReady(true);
    });
  }, []);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  const persist = (m, s, r) => saveState({ messages: m, saved: s, result: r, build: BUILD });

  async function advance(nextMessages) {
    setBusy(true);
    setError(null);
    const nextSaved = { ...saved };
    let submitted = null;
    try {
      const { history } = await runTurn(
        nextMessages,
        (input) => { nextSaved[input.section_id] = input; },
        (input) => { submitted = input; },
      );
      setMessages(history);
      setSaved(nextSaved);
      if (submitted) setResult(submitted);
      persist(history, nextSaved, submitted);
    } catch (e) {
      setError(String(e.message ?? e));
      setMessages(nextMessages);
    }
    setBusy(false);
  }

  const start = () => {
    if (!brief.trim()) return;
    advance([{ role: "user", content: brief.trim() }]);
  };

  const send = () => {
    if (!input.trim() || busy) return;
    const next = [...messages, { role: "user", content: input.trim() }];
    setInput("");
    advance(next);
  };

  const reset = async () => {
    setMessages([]); setSaved({}); setResult(null); setBrief(""); setError(null);
    await saveState({ messages: [], saved: {}, result: null, build: BUILD });
  };

  const shell = {
    height: "100vh", display: "flex", flexDirection: "column",
    background: C.bg, fontFamily: "'Inter', system-ui, sans-serif",
  };

  if (!ready) {
    return <div style={{ ...shell, alignItems: "center", justifyContent: "center", color: C.faint }}>
      Loading…
    </div>;
  }

  if (messages.length === 0) {
    return (
      <div style={{ ...shell, alignItems: "center", justifyContent: "center", padding: 32, gap: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 460 }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: C.text, marginBottom: 6 }}>
            مستشار الجاهزية الاستثمارية
          </div>
          <div style={{ fontSize: 15, color: C.dim, marginBottom: 14 }}>
            SME Investment Readiness — prototype
          </div>
          <div style={{ fontSize: 13, color: C.faint, lineHeight: 1.6 }}>
            Just questions. No documents, no certificates, nothing to upload.
            Tell us what your business does and we'll take it from there.
          </div>
        </div>
        <textarea
          value={brief} onChange={(e) => setBrief(e.target.value)} dir="auto"
          placeholder="e.g. We run two auto workshops in Dammam, mostly fleet contracts…"
          style={{
            width: "100%", maxWidth: 460, minHeight: 90, padding: "12px 14px",
            borderRadius: 12, border: `1px solid ${C.line}`, background: C.panel,
            color: C.text, fontSize: 14, outline: "none", resize: "vertical",
            fontFamily: "inherit", lineHeight: 1.5,
          }}
        />
        <button onClick={start} disabled={!brief.trim()} style={{
          padding: "12px 32px", borderRadius: 12, border: "none",
          background: brief.trim() ? C.accent : C.line, color: "#fff",
          fontSize: 15, fontWeight: 600, cursor: brief.trim() ? "pointer" : "default",
        }}>Start</button>
        <div style={{ fontSize: 10, color: C.faint }}>
          {BUILD.packId} v{BUILD.packVersion} · {MODEL}
        </div>
      </div>
    );
  }

  return (
    <div style={shell}>
      <Progress saved={saved} />
      {result ? (
        <Results result={result} onReset={reset} />
      ) : (
        <>
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px" }}>
            {messages.map((m, i) => {
              const text = typeof m.content === "string"
                ? m.content
                : m.content.filter((b) => b.type === "text").map((b) => b.text).join("");
              if (!text.trim()) return null;
              return <Bubble key={i} role={m.role} text={text} />;
            })}
            {busy && (
              <div style={{
                display: "inline-block", background: C.panel, border: `1px solid ${C.line}`,
                padding: "12px 16px", borderRadius: "18px 18px 18px 4px", color: C.faint, fontSize: 14,
              }}>Thinking…</div>
            )}
            {error && (
              <div style={{
                background: "#f38ba822", border: "1px solid #f38ba855", color: "#f38ba8",
                padding: 12, borderRadius: 10, fontSize: 13, marginTop: 12,
              }}>
                {error}
                <button onClick={() => advance(messages)} style={{
                  marginLeft: 10, background: "none", border: "none",
                  color: C.info, cursor: "pointer", fontSize: 13, textDecoration: "underline",
                }}>Retry</button>
              </div>
            )}
            <div ref={bottom} />
          </div>
          <div style={{
            padding: "12px 16px", borderTop: `1px solid ${C.line}`,
            display: "flex", gap: 8, background: C.bg, flexShrink: 0,
          }}>
            <input
              value={input} onChange={(e) => setInput(e.target.value)} dir="auto"
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && !busy && (e.preventDefault(), send())}
              placeholder="Your answer…" disabled={busy}
              style={{
                flex: 1, padding: "10px 14px", borderRadius: 12,
                border: `1px solid ${C.line}`, background: C.panel,
                color: C.text, fontSize: 14, outline: "none",
              }}
            />
            <button onClick={send} disabled={busy || !input.trim()} style={{
              padding: "10px 20px", borderRadius: 12, border: "none",
              background: busy || !input.trim() ? C.line : C.accent,
              color: "#fff", fontSize: 14, fontWeight: 600,
              cursor: busy ? "default" : "pointer",
            }}>Send</button>
          </div>
        </>
      )}
    </div>
  );
}
