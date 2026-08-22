import { useEffect, useState } from "react";
import { api, type Doc, type DocVersion, type Node, type RoomView } from "../api";

const STATUS_PILL: Record<string, string> = {
  not_requested: "grey",
  requested: "info",
  uploaded: "warn",
  under_review: "warn",
  accepted: "good",
  rejected: "bad",
};

function bytes(n: number) {
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * One component for both sides. The client view differs by what the API
 * returns — requested items only — rather than by hiding things here, which
 * would put the access rule in the wrong place.
 */
export function DataRoom({ clientId, manager }: { clientId: string; manager: boolean }) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);
  const [versions, setVersions] = useState<Record<string, DocVersion[]>>({});

  const path = manager ? `/clients/${clientId}/data-room` : `/me/clients/${clientId}/data-room`;

  const load = async () => {
    try {
      setRoom(await api.get<RoomView>(path));
      setError(null);
    } catch (e: any) {
      setError(e.code === "no_data_room" ? "none" : e.message);
    }
  };

  useEffect(() => { void load(); }, [clientId, manager]);

  const create = async () => {
    setBusy("create");
    await api.post(`/clients/${clientId}/data-room`, {});
    await load();
    setBusy(null);
  };

  const publish = async () => {
    setBusy("publish");
    await api.post(`/clients/${clientId}/data-room/publish`, {
      node_ids: [...selected],
      message: "Your adviser has requested the following.",
    });
    setSelected(new Set());
    await load();
    setBusy(null);
  };

  const toggleHistory = async (nodeId: string) => {
    if (historyOpen === nodeId) return setHistoryOpen(null);
    setHistoryOpen(nodeId);
    if (!versions[nodeId]) {
      const v = await api.get<DocVersion[]>(`/data-room/nodes/${nodeId}/documents`);
      setVersions((prev) => ({ ...prev, [nodeId]: v }));
    }
  };

  const upload = async (nodeId: string, file: File) => {
    setBusy(nodeId);
    try {
      await api.upload(`/me/data-room/nodes/${nodeId}/documents`, file,
        "Shared with my adviser to verify information I provided.");
      await load();
    } catch (e: any) {
      setError(e.code === "unsupported_type" ? "That file type isn't accepted." : e.message);
    }
    setBusy(null);
  };

  if (error === "none") {
    return (
      <div className="card">
        <div style={{ fontWeight: 600 }}>No data room yet</div>
        <p className="muted">
          {manager
            ? "Create one from the standard template, then customise it and request what you need."
            : "Your adviser hasn't requested any documents yet."}
        </p>
        {manager && (
          <button className="primary" onClick={create} disabled={busy === "create"}>
            {busy === "create" ? "Creating…" : "Create from template"}
          </button>
        )}
      </div>
    );
  }

  if (!room) return <p className="muted">Loading…</p>;

  const docsFor = (nodeId: string) => room.documents.filter((d) => d.node_id === nodeId);
  const reasonsFor = (n: Node) =>
    (room.reasons ?? []).filter((r) => r.node_id === n.id);

  const pct = room.progress.requested
    ? Math.round((room.progress.provided / room.progress.requested) * 100)
    : 0;

  const renderNode = (n: Node) => {
    if (n.kind === "folder") {
      return (
        <div key={n.id} className="node">
          <div style={{ fontWeight: 600, margin: "14px 0 4px" }}>
            <span className="path">{n.path}</span>{n.title_en}
          </div>
          {n.children.map(renderNode)}
        </div>
      );
    }

    const docs = docsFor(n.id);
    const reasons = reasonsFor(n);
    const canUpload = !manager && ["requested", "rejected"].includes(n.status);

    return (
      <div key={n.id} className="node item card" style={{ padding: 14 }}>
        <div className="row">
          {manager && n.status === "not_requested" && (
            <input
              type="checkbox" style={{ width: 16 }}
              checked={selected.has(n.id)}
              onChange={(e) => {
                const next = new Set(selected);
                e.target.checked ? next.add(n.id) : next.delete(n.id);
                setSelected(next);
              }}
            />
          )}
          <div style={{ flex: 1 }}>
            <span className="path">{n.path}</span>
            {n.title_en}
            {!n.required && <span className="muted" style={{ fontSize: 12 }}> · optional</span>}
          </div>
          <span className={`pill ${STATUS_PILL[n.status] ?? "grey"}`}>
            {n.status.replace(/_/g, " ")}
          </span>
        </div>

        {n.description_en && (
          <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>{n.description_en}</p>
        )}

        {/* Why this was asked for, in the owner's own words. */}
        {reasons.map((r, i) => (
          <p key={i} className="dim" style={{ fontSize: 12, margin: "6px 0 0", fontStyle: "italic" }}>
            “{r.owner_quote}”
          </p>
        ))}

        {docs.map((d: Doc) => (
          <div key={d.id} className="row" style={{ marginTop: 8, fontSize: 13 }}>
            <span className="dim">{d.filename}</span>
            <span className="muted">{bytes(d.size_bytes)}</span>
            <div style={{ flex: 1 }} />
            {manager && (
              <>
                <a href="#" onClick={(e) => { e.preventDefault(); void toggleHistory(n.id); }}>
                  {historyOpen === n.id ? "Hide history" : "History"}
                </a>
                <a href={api.downloadUrl(d.id)} style={{ marginLeft: 12 }}>Download</a>
              </>
            )}
          </div>
        ))}

        {manager && historyOpen === n.id && (() => {
          const nodeVersions = versions[n.id];
          return (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
            {!nodeVersions ? (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>Loading…</p>
            ) : nodeVersions.length === 0 ? (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>Nothing uploaded yet.</p>
            ) : (
              nodeVersions.map((v) => (
                <div key={v.id} style={{ marginTop: 6 }}>
                  <div className="row" style={{ fontSize: 12 }}>
                    <span className={`pill ${v.superseded_at ? "grey" : "good"}`}>v{v.version}</span>
                    <span className="dim">{v.filename}</span>
                    <span className="muted">
                      {v.uploaded_by_email} · {new Date(v.uploaded_at).toLocaleString()}
                      {v.superseded_at ? " · replaced" : " · current"}
                    </span>
                    <div style={{ flex: 1 }} />
                    <a href={api.downloadUrl(v.id)}>Download</a>
                  </div>
                  {v.extract_status === "done" && v.extract_summary && (
                    <p className="dim" style={{ fontSize: 11, margin: "3px 0 0", fontStyle: "italic" }}>
                      {v.extract_summary}
                    </p>
                  )}
                  {v.extract_status === "pending" && (
                    <p className="muted" style={{ fontSize: 11, margin: "3px 0 0" }}>Reading document…</p>
                  )}
                  {v.extract_status === "unsupported" && (
                    <p className="muted" style={{ fontSize: 11, margin: "3px 0 0" }}>
                      Automatic reading not available for this file type — review it directly.
                    </p>
                  )}
                  {v.extract_status === "failed" && (
                    <p className="muted" style={{ fontSize: 11, margin: "3px 0 0" }}>Reading failed — review it directly.</p>
                  )}
                </div>
              ))
            )}
          </div>
          );
        })()}

        {canUpload && (
          <label style={{ display: "inline-block", marginTop: 10 }}>
            <input
              type="file" style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && upload(n.id, e.target.files[0])}
            />
            <span className="pill info" style={{ cursor: "pointer", padding: "6px 12px" }}>
              {busy === n.id ? "Uploading…" : "Upload"}
            </span>
          </label>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="card">
        <div className="row">
          <div style={{ flex: 1 }}>
            <strong>{room.progress.provided} of {room.progress.requested}</strong>
            <span className="muted"> requested items provided</span>
          </div>
          {manager && selected.size > 0 && (
            <button className="primary" onClick={publish} disabled={busy === "publish"}>
              Request {selected.size} item{selected.size === 1 ? "" : "s"}
            </button>
          )}
        </div>
        <div className="bar" style={{ marginTop: 10 }}><div style={{ width: `${pct}%` }} /></div>
      </div>

      {error && error !== "none" && <div className="card" style={{ color: "var(--bad)" }}>{error}</div>}
      {room.tree.map(renderNode)}
    </div>
  );
}
