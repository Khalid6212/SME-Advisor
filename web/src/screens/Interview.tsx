import { useEffect, useRef, useState } from "react";
import { api } from "../api";

interface Turn { role: string; text: string }
interface Section { section_id: string; complete: boolean }
interface View { status: string; sections: Section[]; messages: Turn[] }

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

export function Interview({ clientId }: { clientId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const load = async () => setView(await api.get<View>(`/me/clients/${clientId}/interview`));
  useEffect(() => { void load(); }, [clientId]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [view, busy]);

  // Grow with content, capped, same as the prototype.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  const send = async () => {
    if (!input.trim() || busy) return;
    const message = input.trim();
    setInput("");
    setBusy(true);
    setError(null);
    try {
      await api.post(`/me/clients/${clientId}/interview/turn`, { message });
      await load();
    } catch (e: any) {
      // The API does not persist the user's turn when the agent fails, so the
      // message is put back rather than silently lost.
      setError(
        e.code === "agent_unavailable"
          ? "The adviser is unavailable right now. Your answer wasn't lost — try again."
          : e.message,
      );
      setInput(message);
    }
    setBusy(false);
  };

  if (!view) return <p className="muted">Loading…</p>;

  const done = view.sections.filter((s) => s.complete).length;

  return (
    <div>
      <div className="card">
        <div className="row" style={{ fontSize: 12 }}>
          <span className="muted">{done} of {ORDER.length} sections complete</span>
        </div>
        <div className="row" style={{ gap: 4, marginTop: 8 }}>
          {ORDER.map((id) => {
            const s = view.sections.find((x) => x.section_id === id);
            const colour = !s ? "var(--line)" : s.complete ? "var(--good)" : "var(--warn)";
            return (
              <div key={id} style={{ flex: 1 }} title={LABELS[id]}>
                <div style={{ height: 3, background: colour, borderRadius: 2 }} />
                <div className="muted" style={{ fontSize: 9, textAlign: "center", marginTop: 4 }}>
                  {LABELS[id]}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="chat">
        {view.messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`} dir="auto">{m.text}</div>
        ))}
        {busy && <div className="bubble assistant muted">Thinking…</div>}
        {error && <div className="card" style={{ color: "var(--bad)" }}>{error}</div>}
        <div ref={bottom} />
      </div>

      {view.status !== "complete" && (
        <div className="row" style={{ alignItems: "flex-end", gap: 8 }}>
          <textarea
            ref={box} rows={1} dir="auto" value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
            }}
            placeholder="Your answer… (Shift+Enter for a new paragraph)"
            style={{ resize: "none", maxHeight: 180 }}
          />
          <button className="primary" onClick={send} disabled={busy || !input.trim()}>Send</button>
        </div>
      )}
      <p className="muted" style={{ fontSize: 12 }}>
        Approximate numbers are fine — “around 400,000 a month” works.
      </p>
    </div>
  );
}
