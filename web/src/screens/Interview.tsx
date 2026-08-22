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

const WELCOME =
  "Hi — welcome. I'll ask about your business across seven short sections: identity, " +
  "revenue, financial health, operations, market, funding need, and records. Approximate " +
  "numbers are fine, and most owners get through all of it in about 15–20 minutes. No " +
  "documents needed yet — just questions. You can pause anytime and pick up where you left off.";

export function Interview({ clientId }: { clientId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
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

  const lastUserIdx = view ? view.messages.map((m) => m.role).lastIndexOf("user") : -1;

  const startEdit = () => {
    if (!view || lastUserIdx === -1) return;
    setInput(view.messages[lastUserIdx]!.text);
    setEditing(true);
    box.current?.focus();
  };

  const cancelEdit = () => {
    setEditing(false);
    setInput("");
  };

  const send = async () => {
    if (!input.trim() || busy) return;
    const message = input.trim();
    setInput("");
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await api.patch(`/me/clients/${clientId}/interview/messages/last`, { message });
        setEditing(false);
      } else {
        await api.post(`/me/clients/${clientId}/interview/turn`, { message });
      }
      await load();
    } catch (e: any) {
      // The API does not persist the user's turn when the agent fails, so the
      // message is put back rather than silently lost.
      setError(
        e.code === "agent_unavailable"
          ? "The adviser is unavailable right now. Your answer wasn't lost — try again."
          : e.code === "no_editable_message"
            ? "There's nothing to edit yet."
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
        <div className="bubble assistant" dir="auto">{WELCOME}</div>

        {view.messages.map((m, i) => (
          <div key={i}>
            <div className={`bubble ${m.role}`} dir="auto">{m.text}</div>
            {i === lastUserIdx && !busy && !editing && view.status !== "complete" && (
              <div style={{ textAlign: "right", marginTop: 2 }}>
                <a
                  href="#" style={{ fontSize: 11 }}
                  onClick={(e) => { e.preventDefault(); startEdit(); }}
                >
                  Edit
                </a>
              </div>
            )}
          </div>
        ))}
        {busy && <div className="bubble assistant muted">Thinking…</div>}
        {error && <div className="card" style={{ color: "var(--bad)" }}>{error}</div>}

        {view.status === "complete" && (
          <div className="card" style={{ borderColor: "var(--good)" }}>
            <strong>Your assessment is complete.</strong>
            <p className="muted" style={{ marginBottom: 0 }}>
              Your adviser will review your answers and get back to you. If anything further
              is needed, they'll request it under the Documents tab.
            </p>
          </div>
        )}
        <div ref={bottom} />
      </div>

      {view.status !== "complete" && (
        <>
          {editing && (
            <div className="row" style={{ fontSize: 12, marginBottom: 6 }}>
              <span className="muted">Editing your last answer</span>
              <a href="#" style={{ marginInlineStart: 8 }} onClick={(e) => { e.preventDefault(); cancelEdit(); }}>
                Cancel
              </a>
            </div>
          )}
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
            <button className="primary" onClick={send} disabled={busy || !input.trim()}>
              {editing ? "Save" : "Send"}
            </button>
          </div>
        </>
      )}
      <p className="muted" style={{ fontSize: 12 }}>
        Approximate numbers are fine — “around 400,000 a month” works.
      </p>
    </div>
  );
}
