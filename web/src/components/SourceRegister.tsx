/**
 * The Source Register, for the manager.
 *
 * Internal sources are read-only here: they are registered automatically as
 * documents arrive in the data room, and letting them be edited by hand
 * would let the register drift from the evidence it describes. External
 * references are the advisor's own research and are entered here — a URL and
 * an access date are judgment calls, not something to infer from a figure.
 *
 * The codes shown are what the drafting agent is allowed to cite and what
 * Appendix A prints, so this list is the whole citable universe for a plan.
 */

import { useEffect, useState } from "react";
import { api } from "../api";

type SourceType =
  | "company_internal" | "external" | "analyst_calculation"
  | "management_assumption" | "analyst_assumption" | "estimate";

interface SourceRow {
  id: string;
  code: string;
  source_type: SourceType;
  title: string;
  publisher: string | null;
  published_on: string | null;
  period_covered: string | null;
  locator: string | null;
  url: string | null;
  accessed_on: string | null;
  confidence: "high" | "medium" | "low";
  document_id: string | null;
}

const TYPE_LABEL: Record<SourceType, string> = {
  company_internal: "Company internal",
  external: "External",
  analyst_calculation: "Analyst calculation",
  management_assumption: "Management assumption",
  analyst_assumption: "Analyst assumption",
  estimate: "Estimate",
};

/** Everything except company_internal — that one is registered from an
 *  upload, never typed in, so offering it here would only create a source
 *  with no document behind it. */
const ENTERABLE_TYPES: SourceType[] = [
  "external", "analyst_calculation", "management_assumption", "analyst_assumption", "estimate",
];

const CONFIDENCE_HINT: Record<SourceRow["confidence"], string> = {
  high: "Audited statements, government statistics, signed contracts.",
  medium: "Management accounts, operational reports, reputable market research.",
  low: "Estimates, or anything built on incomplete information.",
};

const EMPTY = {
  source_type: "external" as SourceType,
  title: "",
  publisher: "",
  published_on: "",
  period_covered: "",
  locator: "",
  url: "",
  accessed_on: "",
  confidence: "medium" as SourceRow["confidence"],
};

export function SourceRegister({ clientId }: { clientId: string }) {
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [draft, setDraft] = useState({ ...EMPTY });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api.get<{ sources: SourceRow[] }>(`/clients/${clientId}/sources`).then((d) => setSources(d.sources));

  useEffect(() => {
    load().catch(() => {});
  }, [clientId]);

  async function add() {
    if (!draft.title.trim()) {
      setError("A title is the one thing a reference cannot go without.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Blank optional fields go as null rather than "" — an empty string in
      // the register renders as a citation with a missing part, which reads
      // worse than a field that is honestly absent.
      const blankToNull = (v: string) => (v.trim() === "" ? null : v.trim());
      await api.post(`/clients/${clientId}/sources`, {
        source_type: draft.source_type,
        title: draft.title.trim(),
        publisher: blankToNull(draft.publisher),
        published_on: blankToNull(draft.published_on),
        period_covered: blankToNull(draft.period_covered),
        locator: blankToNull(draft.locator),
        url: blankToNull(draft.url),
        accessed_on: blankToNull(draft.accessed_on),
        confidence: draft.confidence,
      });
      setDraft({ ...EMPTY });
      setAdding(false);
      await load();
    } catch (e: any) {
      setError(e?.detail ?? e?.message ?? "Could not save that reference.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await api.del(`/clients/${clientId}/sources/${id}`);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Could not remove that reference.");
    } finally {
      setBusy(false);
    }
  }

  const internal = sources.filter((s) => s.document_id !== null);
  const external = sources.filter((s) => s.document_id === null);

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>Source register</div>
      <p className="muted" style={{ fontSize: 12, margin: "2px 0 12px" }}>
        The only things the plan is allowed to cite. Documents register themselves as they arrive in
        the data room; external references are yours to record. Every code here appears in the
        delivered document's Appendix A.
      </p>

      {sources.length === 0 && (
        <p className="muted" style={{ fontSize: 12 }}>
          Nothing registered yet. With an empty register the planner will cite nothing and flag the
          absence instead — which is the correct behaviour, but a thin plan.
        </p>
      )}

      {internal.length > 0 && (
        <>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
            From the data room
          </div>
          {internal.map((s) => (
            <div key={s.id} className="row" style={{ gap: 8, fontSize: 12, padding: "4px 0", alignItems: "baseline" }}>
              <code style={{ minWidth: 64 }}>{s.code}</code>
              <span style={{ flex: 1 }}>{s.title}</span>
              <span className="muted">{s.confidence}</span>
            </div>
          ))}
        </>
      )}

      {external.length > 0 && (
        <>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, margin: "12px 0 6px" }}>
            External references
          </div>
          {external.map((s) => (
            <div key={s.id} className="row" style={{ gap: 8, fontSize: 12, padding: "4px 0", alignItems: "baseline" }}>
              <code style={{ minWidth: 64 }}>{s.code}</code>
              <span style={{ flex: 1 }}>
                {s.title}
                {s.publisher && <span className="muted"> — {s.publisher}</span>}
                {s.locator && <span className="muted"> ({s.locator})</span>}
              </span>
              <span className="muted">{TYPE_LABEL[s.source_type]}</span>
              <button onClick={() => remove(s.id)} disabled={busy}>Remove</button>
            </div>
          ))}
        </>
      )}

      {error && <p style={{ fontSize: 12, color: "var(--bad)" }}>{error}</p>}

      {!adding ? (
        <button style={{ marginTop: 12 }} onClick={() => setAdding(true)}>+ Add external reference</button>
      ) : (
        <div className="card" style={{ marginTop: 12, padding: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <select
              value={draft.source_type}
              onChange={(e) => setDraft({ ...draft, source_type: e.target.value as SourceType })}
            >
              {ENTERABLE_TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_LABEL[t]}</option>
              ))}
            </select>
            <select
              value={draft.confidence}
              onChange={(e) => setDraft({ ...draft, confidence: e.target.value as SourceRow["confidence"] })}
              title={CONFIDENCE_HINT[draft.confidence]}
            >
              <option value="high">High confidence</option>
              <option value="medium">Medium confidence</option>
              <option value="low">Low confidence</option>
            </select>
          </div>
          <p className="muted" style={{ fontSize: 11, margin: "6px 0 0" }}>{CONFIDENCE_HINT[draft.confidence]}</p>

          <input
            style={{ width: "100%", marginTop: 8 }}
            placeholder="Title — e.g. Saudi Arabia Medical Aesthetics Market to 2032"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <input
              style={{ flex: 2 }} placeholder="Publisher"
              value={draft.publisher} onChange={(e) => setDraft({ ...draft, publisher: e.target.value })}
            />
            <input
              style={{ flex: 2 }} placeholder="Page / section"
              value={draft.locator} onChange={(e) => setDraft({ ...draft, locator: e.target.value })}
            />
            <input
              style={{ flex: 1 }} placeholder="Period covered"
              value={draft.period_covered} onChange={(e) => setDraft({ ...draft, period_covered: e.target.value })}
            />
          </div>
          <input
            style={{ width: "100%", marginTop: 6 }} placeholder="URL"
            value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          />
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <div style={{ flex: 1 }}>
              <label className="muted" style={{ fontSize: 11 }}>Published</label>
              <input
                type="date" style={{ width: "100%" }}
                value={draft.published_on} onChange={(e) => setDraft({ ...draft, published_on: e.target.value })}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="muted" style={{ fontSize: 11 }}>Accessed</label>
              <input
                type="date" style={{ width: "100%" }}
                value={draft.accessed_on} onChange={(e) => setDraft({ ...draft, accessed_on: e.target.value })}
              />
            </div>
          </div>

          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button className="primary" onClick={add} disabled={busy}>
              {busy ? "Saving…" : "Register source"}
            </button>
            <button onClick={() => { setAdding(false); setError(null); setDraft({ ...EMPTY }); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
