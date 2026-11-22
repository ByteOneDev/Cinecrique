import { useEffect, useRef } from "react";

export function ModalDialog({
  open,
  onClose,
  labelledBy,
  className,
  as: Element = "div",
  initialFocusRef,
  returnFocusRef: explicitReturnFocusRef,
  children,
  ...props
}) {
  const dialogRef = useRef(null);
  const capturedReturnFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    capturedReturnFocusRef.current = explicitReturnFocusRef?.current || document.activeElement;
    const dialog = dialogRef.current;
    const focusableSelector = "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])";
    const focusInitial = () => {
      const target = initialFocusRef?.current || dialog?.querySelector(focusableSelector) || dialog;
      target?.focus();
    };
    const frame = requestAnimationFrame(focusInitial);
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll(focusableSelector)];
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      capturedReturnFocusRef.current?.focus?.();
    };
  }, [explicitReturnFocusRef, initialFocusRef, open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <Element
        ref={dialogRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        {...props}
      >
        {children}
      </Element>
    </div>
  );
}

export function AppIconButton({ label, active = false, children, className = "", buttonRef, ...props }) {
  return (
    <button ref={buttonRef} className={`icon-button ${active ? "active" : ""} ${className}`} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

