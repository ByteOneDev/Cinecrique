import { useEffect, useRef, useState } from "react";
import { ArrowsClockwise, CloudArrowDown, Globe, WarningCircle, X } from "@phosphor-icons/react";
import { AppIconButton, ModalDialog } from "./ui.jsx";
import {
  ONLINE_COOKIE_BROWSERS,
  ONLINE_QUALITIES,
  normalizeOnlineOptions,
  normalizeOnlineURL,
  onlineDRMWarning,
  onlineSourceLabel,
  onlineToolStatusLabel,
} from "./online.js";

export function OnlineImportDialog({
  open,
  target,
  options,
  onOptionsChange,
  nativeMode,
  toolStatus,
  toolBusy,
  onInstallTool,
  onClose,
  onSubmit,
}) {
  const [address, setAddress] = useState("");
  const inputRef = useRef(null);
  const settings = normalizeOnlineOptions(options);
  const url = normalizeOnlineURL(address);
  const drmWarning = url ? onlineDRMWarning(url) : "";
  const engineReady = Boolean(toolStatus?.available);

  useEffect(() => {
    if (open) setAddress("");
  }, [open]);

  const change = (key, value) => onOptionsChange(normalizeOnlineOptions({ ...settings, [key]: value }));

  return (
    <ModalDialog open={open} onClose={onClose} labelledBy="online-import-title" className="online-dialog" as="form" initialFocusRef={inputRef} onSubmit={(event) => {
      event.preventDefault();
      if (url && engineReady) onSubmit({ url, options: settings });
    }}>
      <div className="composer-heading">
        <div>
          <span>{target === "attach" ? "Associer au projet" : "Nouveau projet"}</span>
          <h2 id="online-import-title">Importer une vidéo en ligne</h2>
        </div>
        <AppIconButton label="Fermer" type="button" onClick={onClose}><X size={19} /></AppIconButton>
      </div>

      <label className="online-url-field">
        <Globe size={18} />
        <input
          ref={inputRef}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          onPaste={(event) => {
            const pasted = event.clipboardData?.getData("text") || "";
            if (pasted) {
              event.preventDefault();
              setAddress(pasted.trim());
            }
          }}
          placeholder="Collez l’adresse de la page vidéo"
          aria-label="Adresse de la vidéo"
          spellCheck="false"
          autoComplete="off"
          maxLength={2_048}
        />
        {url && <span className="online-source">{onlineSourceLabel(url)}</span>}
      </label>
      {address.trim() && !url && <p className="online-warning"><WarningCircle size={15} /> Cette adresse n’est pas une page web publique valide.</p>}
      {drmWarning && <p className="online-warning"><WarningCircle size={15} /> {drmWarning}</p>}
      <p className="online-help">
        YouTube, Internet Archive, Vimeo, Dailymotion, Arte, PeerTube et plus d’un millier de sites, y compris des
        plateformes de streaming moins connues : le moteur reconnaît aussi les lecteurs vidéo intégrés aux pages.
      </p>

      <div className="online-options">
        <label>
          <span>Qualité</span>
          <select value={settings.quality} onChange={(event) => change("quality", event.target.value)}>
            {ONLINE_QUALITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>
          <span>Cookies du navigateur</span>
          <select value={settings.cookiesBrowser} onChange={(event) => change("cookiesBrowser", event.target.value)}>
            {ONLINE_COOKIE_BROWSERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="online-checkbox">
          <input type="checkbox" checked={settings.subtitles} onChange={(event) => change("subtitles", event.target.checked)} />
          Récupérer les sous-titres (français, anglais)
        </label>
      </div>
      {settings.cookiesBrowser && (
        <p className="online-help">
          Les cookies servent uniquement aux sites qui exigent une connexion. Ils sont lus localement par le moteur et ne sont
          jamais enregistrés par Cinécrique. Safari demande l’accès complet au disque dans Réglages Système.
        </p>
      )}

      <div className="online-engine">
        <span className={engineReady ? "ready" : ""}>{nativeMode ? onlineToolStatusLabel(toolStatus) : "Disponible dans l’application macOS"}</span>
        {nativeMode && (
          <button type="button" disabled={toolBusy} onClick={onInstallTool}>
            {toolBusy ? <ArrowsClockwise size={15} className="spin" /> : <CloudArrowDown size={15} />}
            {toolBusy ? "Installation…" : engineReady ? "Mettre à jour le moteur" : "Installer le moteur"}
          </button>
        )}
      </div>

      <div className="composer-actions">
        <button type="button" onClick={onClose}>Annuler</button>
        <button className="primary" type="submit" disabled={!url || !engineReady || !nativeMode}>
          <CloudArrowDown size={17} /> Télécharger et ouvrir
        </button>
      </div>
      <small className="online-footnote">
        La vidéo est enregistrée dans Films › Cinécrique puis analysée comme un fichier local. Les flux protégés par DRM ne
        sont pas pris en charge.
      </small>
    </ModalDialog>
  );
}
