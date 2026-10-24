import { createContext, useContext, useEffect, useRef, useState } from "react";

// Modal confirmation dialog — frosted mask + centered card + buttons, the
// same pattern dsh-pet's settings page uses for its destructive actions.
//
// The overlay covers the whole (transparent) window and is registered as a
// hot zone by Island, so clicks anywhere inside the window land on the mask
// instead of passing through to the app underneath. Mask click = cancel;
// card clicks are stopped from bubbling; Escape = cancel.

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
}

export type RaiseConfirm = (req: ConfirmRequest) => Promise<boolean>;

// Default: no provider (dev/mock) → every confirmation resolves "cancel",
// so destructive actions stay inert rather than silently executing.
export const ConfirmContext = createContext<RaiseConfirm>(async () => false);

export function useConfirm(): RaiseConfirm {
  return useContext(ConfirmContext);
}

interface Props {
  request: ConfirmRequest | null;
  onSettle: (ok: boolean) => void;
}

export function ConfirmDialog({ request, onSettle }: Props) {
  // Escape = cancel while the dialog is up.
  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSettle(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, onSettle]);

  if (!request) return null;
  return (
    <div className="confirm-overlay" onClick={() => onSettle(false)}>
      <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-title">{request.title}</div>
        <div className="confirm-body">{request.body}</div>
        <div className="confirm-actions">
          <button className="confirm-btn" onClick={() => onSettle(false)}>
            取消
          </button>
          <button
            className={`confirm-btn ${request.danger ? "danger" : "primary"}`}
            onClick={() => onSettle(true)}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Hook up the provider logic (state + resolver) for a host component. Kept
// next to the dialog so the contract stays in one file.
export function useConfirmState(): {
  request: ConfirmRequest | null;
  raise: RaiseConfirm;
  settle: (ok: boolean) => void;
} {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const raise: RaiseConfirm = (req) => {
    return new Promise<boolean>((resolve) => {
      // A second raise while one is pending cancels the first — there is
      // only one dialog slot.
      resolverRef.current?.(false);
      resolverRef.current = resolve;
      setRequest(req);
    });
  };

  const settle = (ok: boolean) => {
    resolverRef.current?.(ok);
    resolverRef.current = null;
    setRequest(null);
  };

  return { request, raise, settle };
}
