import { useEffect, useMemo, useRef, useState } from "react";
import { FilmStrip, Image as ImageIcon, MagnifyingGlass, X } from "@phosphor-icons/react";
import { AppIconButton } from "./ui.jsx";

/**
 * Sélecteur de plan partagé par les notes et le scénario. Propose l’image
 * actuelle (qui devient un repère si besoin) puis les plages et repères du
 * projet. Ne crée rien lui-même : il renvoie le choix à l’atelier.
 */
export function PlanPicker({ open, title, markers, currentLabel, formatTimecode, onPick, onClose, className = "" }) {
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setQuery("");
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    const close = (event) => {
      if (!rootRef.current?.contains(event.target) && !event.target.closest?.("[data-plan-picker-trigger]")) onClose();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("fr");
    return (markers || [])
      .filter((marker) => !needle || `${marker.title} ${marker.tag} ${marker.detail}`.toLocaleLowerCase("fr").includes(needle))
      .sort((a, b) => Number(Number(b.endTime) > Number(b.time)) - Number(Number(a.endTime) > Number(a.time)) || a.time - b.time)
      .slice(0, 300);
  }, [markers, query]);

  if (!open) return null;
  return (
    <div ref={rootRef} className={`plan-picker ${className}`} role="dialog" aria-label={title}>
      <div className="plan-picker-heading">
        <strong>{title}</strong>
        <AppIconButton label="Fermer" type="button" onClick={onClose}><X size={14} /></AppIconButton>
      </div>
      <button type="button" className="plan-picker-current" onClick={() => onPick(null)}>
        <ImageIcon size={16} />
        <span><strong>Image actuelle</strong><small>{currentLabel}</small></span>
      </button>
      <label className="plan-picker-search">
        <MagnifyingGlass size={14} />
        <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un plan ou un repère" aria-label="Rechercher un plan ou un repère" maxLength={200} />
      </label>
      <div className="plan-picker-list">
        {rows.map((marker) => {
          const range = Number(marker.endTime) > Number(marker.time);
          return (
            <button key={marker.id} type="button" onClick={() => onPick(marker)}>
              <i style={{ background: marker.color || "#d8a432" }} aria-hidden="true" />
              <time>{formatTimecode(marker.time)}</time>
              <span>{marker.title}</span>
              {range && <FilmStrip size={13} aria-label="Plage" />}
            </button>
          );
        })}
        {!rows.length && <p>Aucun repère ne correspond.</p>}
      </div>
    </div>
  );
}
