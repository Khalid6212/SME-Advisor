/**
 * Local by design — each screen holds its own "what am I confirming" state,
 * the same way the rest of this app prefers local state over shared
 * infrastructure. This component only renders what's handed to it.
 */
export function ConfirmDialog({
  open, title, message, confirmLabel = "Confirm", danger, busy, onConfirm, onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="confirm-dialog-title" style={{ fontWeight: 600, marginBottom: 8 }}>{title}</div>
        <p className="muted" style={{ marginTop: 0 }}>{message}</p>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 18 }}>
          <button onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            className={danger ? "" : "primary"}
            style={danger ? { borderColor: "var(--bad)", color: "var(--bad)" } : undefined}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
