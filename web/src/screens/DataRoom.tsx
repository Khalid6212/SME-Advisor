import { useEffect, useState } from "react";
import { api, type Doc, type DocVersion, type Node, type RoomView, type Suggestion } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";

const STATUS_PILL: Record<string, string> = {
  not_requested: "grey",
  requested: "info",
  uploaded: "warn",
  under_review: "warn",
  accepted: "good",
  rejected: "bad",
};

const FOLDER_MARK: Record<string, string> = {
  not_requested: "--line",
  requested: "--info",
  uploaded: "--warn",
  under_review: "--warn",
  accepted: "--good",
  rejected: "--bad",
};

/** All `item`-kind descendants under a set of nodes, recursing through
 *  nested folders — used to roll a folder's contents up into a single
 *  ratio + status-mark strip in its collapsed header. */
function flattenItems(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    if (n.kind === "item") out.push(n);
    else out.push(...flattenItems(n.children));
  }
  return out;
}

function bytes(n: number) {
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

interface NodeFormData {
  kind: "folder" | "item";
  title_en: string;
  title_ar: string;
  description_en: string;
  required: boolean;
}

/** Shared by "add a node" and "edit a node" — same fields either way, only
 *  `kind` is add-only (it can't change after creation). */
function NodeForm({
  initial, allowKind, submitLabel, onSubmit, onCancel,
}: {
  initial?: Partial<NodeFormData>;
  allowKind: boolean;
  submitLabel: string;
  onSubmit: (data: NodeFormData) => Promise<void>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<"folder" | "item">(initial?.kind ?? "item");
  const [titleEn, setTitleEn] = useState(initial?.title_en ?? "");
  const [titleAr, setTitleAr] = useState(initial?.title_ar ?? "");
  const [descEn, setDescEn] = useState(initial?.description_en ?? "");
  const [required, setRequired] = useState(initial?.required ?? true);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await onSubmit({ kind, title_en: titleEn.trim(), title_ar: titleAr.trim(), description_en: descEn.trim(), required });
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="card" style={{ padding: 12, marginTop: 8 }}>
      {allowKind && (
        <div className="row" style={{ gap: 12, marginBottom: 8, fontSize: 13 }}>
          <label className="row" style={{ gap: 6, cursor: "pointer" }}>
            <input type="radio" checked={kind === "item"} onChange={() => setKind("item")} style={{ width: "auto" }} />
            Document
          </label>
          <label className="row" style={{ gap: 6, cursor: "pointer" }}>
            <input type="radio" checked={kind === "folder"} onChange={() => setKind("folder")} style={{ width: "auto" }} />
            Folder
          </label>
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <input
          required value={titleEn} placeholder="Title (English)" autoFocus
          onChange={(e) => setTitleEn(e.target.value)} style={{ flex: 1 }}
        />
        <input
          required value={titleAr} placeholder="العنوان (عربي)"
          onChange={(e) => setTitleAr(e.target.value)} style={{ flex: 1 }}
        />
      </div>
      {kind === "item" && (
        <input
          value={descEn} placeholder="Description (optional)"
          onChange={(e) => setDescEn(e.target.value)} style={{ marginTop: 8 }}
        />
      )}
      {kind === "item" && (
        <label className="row" style={{ gap: 8, fontSize: 13, marginTop: 8, cursor: "pointer" }}>
          <input
            type="checkbox" checked={required}
            onChange={(e) => setRequired(e.target.checked)} style={{ width: "auto" }}
          />
          Required
        </label>
      )}
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button className="primary" disabled={busy || !titleEn.trim() || !titleAr.trim()}>
          {busy ? "Saving…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
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
  const [remindSelected, setRemindSelected] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);
  const [versions, setVersions] = useState<Record<string, DocVersion[]>>({});
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [addingTo, setAddingTo] = useState<string | "root" | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; label: string } | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  const path = manager ? `/clients/${clientId}/data-room` : `/me/clients/${clientId}/data-room`;

  const load = async () => {
    try {
      setRoom(await api.get<RoomView>(path));
      setError(null);
    } catch (e: any) {
      setError(e.code === "no_data_room" ? "none" : e.message);
    }
    if (manager) {
      try {
        setSuggestions(await api.get<Suggestion[]>(`/clients/${clientId}/data-room/suggested`));
      } catch {
        setSuggestions([]);
      }
    }
  };

  useEffect(() => { void load(); }, [clientId, manager]);

  const create = async (blank: boolean) => {
    setBusy(blank ? "create-blank" : "create");
    await api.post(`/clients/${clientId}/data-room`, blank ? { template_key: "blank" } : {});
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

  const remind = async () => {
    setBusy("remind");
    await api.post(`/clients/${clientId}/data-room/remind`, { node_ids: [...remindSelected] });
    setRemindSelected(new Set());
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
      if (manager) {
        await api.upload(`/clients/${clientId}/data-room/nodes/${nodeId}/documents`, file,
          "Uploaded by the advisory team on the client's behalf.");
      } else {
        await api.upload(`/me/data-room/nodes/${nodeId}/documents`, file,
          "Shared with my adviser to verify information I provided.");
      }
      await load();
    } catch (e: any) {
      setError(e.code === "unsupported_type" ? "That file type isn't accepted." : e.message);
    }
    setBusy(null);
  };

  const setNodeStatus = async (nodeId: string, status: "accepted" | "rejected") => {
    setBusy(nodeId);
    await api.patch(`/data-room/nodes/${nodeId}`, { status });
    await load();
    setBusy(null);
  };

  const addNode = async (parentId: string | null, data: NodeFormData) => {
    await api.post(`/clients/${clientId}/data-room/nodes`, {
      parent_id: parentId,
      kind: data.kind,
      title_en: data.title_en,
      title_ar: data.title_ar,
      description_en: data.kind === "item" ? data.description_en || undefined : undefined,
      required: data.kind === "item" ? data.required : undefined,
    });
    setAddingTo(null);
    await load();
  };

  const addSuggestion = async (s: Suggestion) => {
    setBusy(`suggest-${s.document_type}`);
    await api.post(`/clients/${clientId}/data-room/nodes`, {
      parent_id: null,
      kind: "item",
      title_en: s.title,
      title_ar: s.title,
      document_type: s.document_type,
      required: true,
    });
    await load();
    setBusy(null);
  };

  const updateNode = async (nodeId: string, data: NodeFormData) => {
    await api.patch(`/data-room/nodes/${nodeId}`, {
      title_en: data.title_en,
      title_ar: data.title_ar,
      description_en: data.description_en || null,
      required: data.required,
    });
    setEditing(null);
    await load();
  };

  const deleteNode = async (nodeId: string) => {
    setBusy(nodeId);
    await api.del(`/data-room/nodes/${nodeId}`);
    setDeleting(null);
    setBusy(null);
    await load();
  };

  if (error === "none") {
    return (
      <div className="card">
        <div style={{ fontWeight: 600 }}>No data room yet</div>
        <p className="muted">
          {manager
            ? "Start from the standard template and trim what doesn't apply, or build one from scratch for a business the template doesn't fit."
            : "Your adviser hasn't requested any documents yet."}
        </p>
        {manager && (
          <div className="row" style={{ gap: 8 }}>
            <button className="primary" onClick={() => create(false)} disabled={busy !== null}>
              {busy === "create" ? "Creating…" : "Create from template"}
            </button>
            <button onClick={() => create(true)} disabled={busy !== null}>
              {busy === "create-blank" ? "Creating…" : "Start blank"}
            </button>
          </div>
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
  const statusCounts = room.tree.length
    ? flattenItems(room.tree).reduce<Record<string, number>>((acc, it) => {
        acc[it.status] = (acc[it.status] ?? 0) + 1;
        return acc;
      }, {})
    : {};

  const notYetAdded = suggestions.filter((s) => s.node_id === null);

  const toggleFolder = (id: string) =>
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const renderNode = (n: Node) => {
    if (n.kind === "folder") {
      const items = flattenItems([n]);
      const done = items.filter((it) => it.status === "accepted").length;
      const isOpen = !collapsedFolders.has(n.id);
      return (
        <div key={n.id} className="node">
          <button className={`folder-head${isOpen ? " open" : ""}`} onClick={() => toggleFolder(n.id)}>
            <svg className="chev" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor"
                 strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3.5 10.5 8 6 12.5" />
            </svg>
            <span className="path" style={{ fontSize: 11.5 }}>{n.path}</span>
            <strong style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 15 }}>{n.title_en}</strong>
            <span dir="rtl" className="muted" style={{ fontSize: 13 }}>{n.title_ar}</span>
            <div style={{ flex: 1 }} />
            {items.length > 0 && (
              <>
                <span className="muted" style={{ fontSize: 11.5 }}>{done}/{items.length}</span>
                <div className="folder-marks">
                  {items.map((it) => (
                    <div key={it.id} style={{ background: `var(${FOLDER_MARK[it.status] ?? "--line"})` }} />
                  ))}
                </div>
              </>
            )}
          </button>

          {isOpen && (
            <>
              {manager && editing === n.id ? (
                <NodeForm
                  allowKind={false}
                  initial={{ title_en: n.title_en, title_ar: n.title_ar, description_en: n.description_en ?? "" }}
                  submitLabel="Save"
                  onSubmit={(data) => updateNode(n.id, data)}
                  onCancel={() => setEditing(null)}
                />
              ) : manager && (
                <div className="row" style={{ padding: "6px 4px 0", gap: 8 }}>
                  <button onClick={() => { setEditing(n.id); setAddingTo(null); }}>Edit folder</button>
                  <button onClick={() => setDeleting({ id: n.id, label: n.title_en })}>Delete folder</button>
                </div>
              )}
              {n.children.map(renderNode)}
              {manager && (
                addingTo === n.id ? (
                  <NodeForm
                    allowKind
                    submitLabel="Add"
                    onSubmit={(data) => addNode(n.id, data)}
                    onCancel={() => setAddingTo(null)}
                  />
                ) : (
                  <button onClick={() => { setAddingTo(n.id); setEditing(null); }} style={{ marginTop: 4 }}>
                    + Add here
                  </button>
                )
              )}
            </>
          )}
        </div>
      );
    }

    const docs = docsFor(n.id);
    const reasons = reasonsFor(n);
    const canUpload = manager || ["requested", "rejected"].includes(n.status);
    const canReview = manager && ["uploaded", "under_review"].includes(n.status);

    if (manager && editing === n.id) {
      return (
        <div key={n.id} className="node item">
          <NodeForm
            allowKind={false}
            initial={{ title_en: n.title_en, title_ar: n.title_ar, description_en: n.description_en ?? "", required: n.required }}
            submitLabel="Save"
            onSubmit={(data) => updateNode(n.id, data)}
            onCancel={() => setEditing(null)}
          />
        </div>
      );
    }

    const checkbox =
      manager && n.status === "not_requested" ? (
        <input
          type="checkbox" style={{ width: 16 }}
          checked={selected.has(n.id)}
          onChange={(e) => {
            const next = new Set(selected);
            e.target.checked ? next.add(n.id) : next.delete(n.id);
            setSelected(next);
          }}
        />
      ) : manager && ["requested", "rejected"].includes(n.status) ? (
        <input
          type="checkbox" style={{ width: 16 }} title="Select to remind"
          checked={remindSelected.has(n.id)}
          onChange={(e) => {
            const next = new Set(remindSelected);
            e.target.checked ? next.add(n.id) : next.delete(n.id);
            setRemindSelected(next);
          }}
        />
      ) : null;

    return (
      <div key={n.id} className="node item">
        <div className="drrow">
          <div>{checkbox}</div>
          <span className="path" style={{ fontSize: 11.5, paddingTop: 1 }}>{n.path}</span>

          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <span>{n.title_en}</span>
              <span dir="rtl" className="muted" style={{ fontSize: 12 }}>{n.title_ar}</span>
              {!n.required && <span className="muted" style={{ fontSize: 12 }}>optional</span>}
            </div>
            {n.description_en && (
              <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>{n.description_en}</p>
            )}
            {reasons.map((r, i) => (
              <p key={i} className="dim" style={{ fontSize: 12, margin: "4px 0 0", fontStyle: "italic" }}>
                “{r.owner_quote}”
              </p>
            ))}
          </div>

          <div style={{ fontSize: 12.5 }}>
            {docs.length === 0 ? (
              <span className="muted">Nothing uploaded</span>
            ) : (
              docs.map((d: Doc) => (
                <div key={d.id} style={{ marginBottom: 3 }}>
                  <span className="dim">{d.filename}</span>{" "}
                  <span className="muted">{bytes(d.size_bytes)}</span>
                  {manager && <a href={api.downloadUrl(d.id)} style={{ marginLeft: 8 }}>Download</a>}
                </div>
              ))
            )}
            {manager && docs.length > 0 && (
              <a href="#" onClick={(e) => { e.preventDefault(); void toggleHistory(n.id); }}>
                {historyOpen === n.id ? "Hide history" : "History"}
              </a>
            )}
          </div>

          <span className={`pill ${STATUS_PILL[n.status] ?? "grey"}`}>
            {n.status.replace(/_/g, " ")}
          </span>

          <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
            {canReview && (
              <>
                <button
                  style={{ borderColor: "var(--good)", color: "var(--good)" }}
                  disabled={busy === n.id}
                  onClick={() => setNodeStatus(n.id, "accepted")}
                >
                  Accept
                </button>
                <button
                  style={{ borderColor: "var(--bad)", color: "var(--bad)" }}
                  disabled={busy === n.id}
                  onClick={() => setNodeStatus(n.id, "rejected")}
                >
                  Reject
                </button>
              </>
            )}
            {canUpload && (
              <label style={{ display: "inline-block" }}>
                <input
                  type="file" style={{ display: "none" }}
                  onChange={(e) => e.target.files?.[0] && upload(n.id, e.target.files[0])}
                />
                <span className="pill info" style={{ cursor: "pointer", padding: "6px 12px" }}>
                  {busy === n.id ? "Uploading…" : "Upload"}
                </span>
              </label>
            )}
            {manager && (
              <>
                <button onClick={() => { setEditing(n.id); setAddingTo(null); }}>Edit</button>
                <button onClick={() => setDeleting({ id: n.id, label: n.title_en })}>Delete</button>
              </>
            )}
          </div>
        </div>

        {manager && historyOpen === n.id && (() => {
          const nodeVersions = versions[n.id];
          return (
          <div style={{ padding: "0 12px 10px", borderTop: "1px solid var(--line-soft)" }}>
            {!nodeVersions ? (
              <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>Loading…</p>
            ) : nodeVersions.length === 0 ? (
              <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>Nothing uploaded yet.</p>
            ) : (
              nodeVersions.map((v) => (
                <div key={v.id} style={{ marginTop: 8 }}>
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
      </div>
    );
  };

  const totalItems = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const STATUS_LABEL: Record<string, string> = {
    not_requested: "not requested", requested: "requested", uploaded: "uploaded",
    under_review: "in review", accepted: "accepted", rejected: "rejected",
  };

  return (
    <div>
      <div className="card">
        <div className="row">
          <div style={{ flex: 1 }}>
            <strong>{room.progress.provided} of {room.progress.requested}</strong>
            <span className="muted"> requested items provided</span>
          </div>
          {manager && remindSelected.size > 0 && (
            <button onClick={remind} disabled={busy === "remind"} style={{ marginInlineEnd: 8 }}>
              {busy === "remind" ? "Sending…" : `Remind about ${remindSelected.size} item${remindSelected.size === 1 ? "" : "s"}`}
            </button>
          )}
          {manager && selected.size > 0 && (
            <button className="primary" onClick={publish} disabled={busy === "publish"}>
              Request {selected.size} item{selected.size === 1 ? "" : "s"}
            </button>
          )}
        </div>
        {totalItems > 0 ? (
          <>
            <div className="bar-segmented" style={{ marginTop: 10 }}>
              {Object.entries(statusCounts)
                .filter(([, count]) => count > 0)
                .map(([status, count]) => (
                  <div key={status} style={{ width: `${(count / totalItems) * 100}%`, background: `var(${FOLDER_MARK[status] ?? "--line"})` }} />
                ))}
            </div>
            <div className="row" style={{ marginTop: 6, gap: 14, flexWrap: "wrap" }}>
              {Object.entries(statusCounts).filter(([, count]) => count > 0).map(([status, count]) => (
                <span key={status} className="muted" style={{ fontSize: 11.5 }}>
                  <span style={{ color: `var(${FOLDER_MARK[status] ?? "--line"})` }}>●</span> {count} {STATUS_LABEL[status] ?? status}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="bar" style={{ marginTop: 10 }}><div style={{ width: `${pct}%` }} /></div>
        )}
      </div>

      {error && error !== "none" && <div className="card" style={{ color: "var(--bad)" }}>{error}</div>}

      {manager && notYetAdded.length > 0 && !suggestionsOpen && (
        <div style={{ textAlign: "right", marginTop: 12 }}>
          <button onClick={() => setSuggestionsOpen(true)}>
            Suggested documents ({notYetAdded.length})
          </button>
        </div>
      )}

      <div className="split" style={{ marginTop: 12 }}>
        <div className="mainc">
          {room.tree.map(renderNode)}

          {manager && (
            addingTo === "root" ? (
              <NodeForm
                allowKind
                submitLabel="Add"
                onSubmit={(data) => addNode(null, data)}
                onCancel={() => setAddingTo(null)}
              />
            ) : (
              <button onClick={() => { setAddingTo("root"); setEditing(null); }} style={{ marginTop: 12 }}>
                + Add top-level folder or document
              </button>
            )
          )}
        </div>

        {manager && notYetAdded.length > 0 && suggestionsOpen && (
          <div className="rail">
            <div className="card">
              <div className="row" style={{ marginBottom: 4 }}>
                <div style={{ fontWeight: 600, flex: 1 }}>Suggested, based on the interview</div>
                <button onClick={() => setSuggestionsOpen(false)} style={{ fontSize: 11.5, padding: "3px 8px" }}>
                  Hide
                </button>
              </div>
              <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                Documents that would verify what the owner already told us — not yet in this room.
              </p>
              {notYetAdded.map((s) => (
                <div key={s.document_type} style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 13 }}>{s.title}</div>
                  {s.reasons.map((r, i) => (
                    <p key={i} className="dim" style={{ fontSize: 12, margin: "2px 0 0", fontStyle: "italic" }}>
                      “{r.owner_quote}”
                    </p>
                  ))}
                  <button
                    style={{ marginTop: 6 }}
                    onClick={() => addSuggestion(s)}
                    disabled={busy === `suggest-${s.document_type}`}
                  >
                    {busy === `suggest-${s.document_type}` ? "Adding…" : "Add to room"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        danger
        title={`Delete "${deleting?.label}"?`}
        message="This removes it (and anything nested under it, plus any uploaded document) permanently — there is no undo."
        confirmLabel="Delete"
        busy={busy === deleting?.id}
        onConfirm={() => deleting && deleteNode(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
