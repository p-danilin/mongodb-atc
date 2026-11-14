import { useEffect, useRef, useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import type { Action } from "@contract/types";
import { api } from "../lib/api";
import { approvalRow } from "../lib/approvals";
import { approvalsChip, resolveControl } from "../lib/controls";
import { store, useSelector } from "../state/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./Panels";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function Row({ action, gateNames }: { action: Action; gateNames: Record<string, string> }) {
  const vehicles = useSelector((s) => s.vehicles);
  const row = approvalRow(action, vehicles, gateNames);
  const resolveOk = resolveControl(useSelector((s) => s.run, (a, b) => a === b));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { if (store.getState().highlightedApproval === action._id) store.highlightApproval(null); }, [action._id]);

  // The row leaves on the `approval.resolved` message, not on this response.
  const resolve = async (decision: "approve" | "deny") => {
    setBusy(true); setError(null);
    try { await api.resolveApproval(action._id, { decision, note: note.trim() || undefined }); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <li
      className="flex flex-col gap-2 rounded-md border bg-card p-3 transition-shadow hover:ring-2 hover:ring-[var(--map-pending)] focus-within:ring-2 focus-within:ring-[var(--map-pending)]"
      data-testid="approval-row"
      onMouseEnter={() => store.highlightApproval(action._id)}
      onMouseLeave={() => store.highlightApproval(null)}
      onFocus={() => store.highlightApproval(action._id)}
      onBlur={() => store.highlightApproval(null)}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium">{row.title}</span>
        <div className="flex flex-wrap justify-end gap-1">
          {row.policyIds.map((p) => <Badge key={p} variant="outline">{p}</Badge>)}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{row.reason}</p>
      <input
        aria-label={`Note for ${row.title}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        disabled={busy}
        className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      />
      {(() => {
        const buttons = (
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || !resolveOk.enabled} onClick={() => resolve("approve")}><CheckIcon data-icon="inline-start" />Approve</Button>
            <Button size="sm" variant="outline" disabled={busy || !resolveOk.enabled} onClick={() => resolve("deny")}><XIcon data-icon="inline-start" />Deny</Button>
          </div>
        );
        return resolveOk.reason ? (
          <Tooltip><TooltipTrigger asChild><span tabIndex={0} className="w-fit">{buttons}</span></TooltipTrigger><TooltipContent>{resolveOk.reason}</TooltipContent></Tooltip>
        ) : buttons;
      })()}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </li>
  );
}

/** The pending list comes from the snapshot and the approval messages; the UI never derives it from decisions. */
export function ApprovalQueue({ gateNames }: { gateNames: Record<string, string> }) {
  const pending = useSelector((s) => s.pendingApprovals);
  if (!pending.length) return <EmptyState title="Nothing waiting" body="Routes that need a human decision queue here for approval." />;
  return <ul className="flex flex-col gap-2">{pending.map((a) => <Row key={a._id} action={a} gateNames={gateNames} />)}</ul>;
}

/** Count on the Approvals tab. It pulses once each time the count goes up. */
export function PendingCount() {
  const n = useSelector((s) => s.pendingApprovals.length);
  const prev = useRef(n);
  const [bump, setBump] = useState(0);
  useEffect(() => { if (n > prev.current) setBump((b) => b + 1); prev.current = n; }, [n]);
  return n ? <Badge key={bump} data-testid="pending-count" className={`ml-1.5 h-4 min-w-4 px-1 text-[10px] ${bump ? "badge-bump" : ""}`}>{n}</Badge> : null;
}

/** Header chip. Selects the Approvals tab on click; tabs never switch on their own. */
export function ApprovalsChip() {
  const text = useSelector((s) => approvalsChip(s.pendingApprovals));
  if (!text) return null;
  return (
    <button type="button" data-testid="approvals-chip" onClick={() => store.setTab("approvals")}
      className="rounded-full border border-[var(--map-pending)] bg-amber-50 px-3 py-1 text-sm font-medium text-amber-900 hover:bg-amber-100">
      {text}
    </button>
  );
}
