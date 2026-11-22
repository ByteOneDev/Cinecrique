import { useMemo, useState } from "react";
import {
  Archive,
  ArrowRight,
  ArrowsClockwise,
  CheckCircle,
  CloudArrowDown,
  DotsThree,
  FileText,
  FilmSlate,
  FolderOpen,
  Globe,
  MagnifyingGlass,
  Plus,
  UploadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import { ProjectCover } from "./ProjectCover.jsx";
import { LAUNCHER_SORTS, launcherProjects, openedLabel, projectStats, statsLabel } from "./launcher.js";
import { updateNotesLines, updateStageLabel } from "./update.js";

function LauncherAction({ icon, title, detail, onClick, shortcut }) {
  return (
    <button type="button" className="launcher-action" onClick={onClick}>
      <span className="launcher-action-icon">{icon}</span>
      <span className="launcher-action-copy"><strong>{title}</strong><small>{detail}</small></span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}

function UpdateCard({ nativeMode, appVersion, updateState, autoUpdate, onAutoUpdateChange, onCheck, onInstall, onOpenRelease }) {
  const stage = updateState?.stage || "idle";
  const busy = ["checking", "downloading", "verifying", "installing"].includes(stage);
  const notes = updateNotesLines(updateState?.notes, 4);
  return (
    <section className={`launcher-update stage-${stage}`} aria-label="Mises à jour">
      <div className="launcher-update-heading">
        {stage === "available" || stage === "ready" ? <CloudArrowDown size={17} /> : stage === "failed" ? <WarningCircle size={17} /> : <CheckCircle size={17} />}
        <span>
          <strong>{stage === "available" ? `Cinécrique ${updateState.version}` : updateStageLabel(stage)}</strong>
          <small>{appVersion ? `Version installée ${appVersion}` : "Version de développement"}</small>
        </span>
      </div>
      {updateState?.message && stage !== "idle" && <p>{updateState.message}</p>}
      {stage === "available" && notes.length > 0 && (
        <ul>{notes.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul>
      )}
      {busy && <progress value={stage === "checking" ? undefined : updateState?.progress || 0} max="1" aria-label="Progression de la mise à jour" />}
      <div className="launcher-update-actions">
        {stage === "available" && updateState?.canInstall && (
          <button type="button" className="primary" onClick={onInstall}><CloudArrowDown size={15} /> Installer et relancer</button>
        )}
        {stage === "available" && !updateState?.canInstall && updateState?.releaseURL && (
          <button type="button" className="primary" onClick={onOpenRelease}><ArrowRight size={15} /> Voir la version</button>
        )}
        {stage !== "available" && (
          <button type="button" disabled={!nativeMode || busy} onClick={onCheck}><ArrowsClockwise size={15} /> Rechercher</button>
        )}
      </div>
      <label className="launcher-update-toggle">
        <input type="checkbox" checked={autoUpdate} disabled={!nativeMode} onChange={(event) => onAutoUpdateChange(event.target.checked)} />
        Vérifier automatiquement chaque jour
      </label>
    </section>
  );
}

export function Launcher({
  projects,
  documents,
  activeProjectId,
  query,
  onQueryChange,
  sort,
  onSortChange,
  onOpen,
  onProjectMenu,
  projectMenuId,
  onImportVideo,
  onImportOnline,
  onImportFountain,
  onNewProject,
  onImportProject,
  nativeMode,
  appVersion,
  updateState,
  autoUpdate,
  onAutoUpdateChange,
  onCheckUpdates,
  onInstallUpdate,
  onOpenRelease,
}) {
  const [showArchives, setShowArchives] = useState(false);
  const entries = useMemo(
    () => launcherProjects(projects, { query, sort, archived: showArchives }),
    [projects, query, showArchives, sort],
  );
  const archivedCount = useMemo(() => (projects || []).filter((project) => project.archived).length, [projects]);
  const activeCount = (projects || []).length - archivedCount;
  const resume = useMemo(() => {
    if (showArchives || query.trim()) return null;
    const recent = launcherProjects(projects, { sort: "recent" });
    return recent.find(({ project }) => project.id === activeProjectId) || recent[0] || null;
  }, [activeProjectId, projects, query, showArchives]);
  const resumeStats = resume ? projectStats(documents?.[resume.project.id]) : null;

  return (
    <div className="launcher" aria-label="Gestionnaire de projets">
      <header className="launcher-topbar">
        <div className="window-controls" aria-hidden="true">
          <span className="window-dot close" />
          <span className="window-dot minimize" />
          <span className="window-dot maximize" />
        </div>
        <div className="brand-lockup">
          <img className="brand-mark" src="./assets/cinecrique-mark.svg" alt="" />
          <div className="brand-copy">
            <strong>Cinécrique</strong>
            <span>Analyse filmique, image par image</span>
          </div>
        </div>
        <div className="launcher-topbar-actions">
          <label className="search-field">
            <MagnifyingGlass size={17} />
            <input aria-label="Rechercher un projet" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Rechercher un projet" maxLength={200} />
          </label>
          <select className="launcher-sort" aria-label="Trier les projets" value={sort} onChange={(event) => onSortChange(event.target.value)}>
            {LAUNCHER_SORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
      </header>

      <div className="launcher-body">
        <aside className="launcher-sidebar">
          <h2>Nouveau projet</h2>
          <div className="launcher-actions">
            <LauncherAction icon={<FilmSlate size={19} />} title="Vidéo locale" detail="MP4, MOV, MKV, AVI, MXF…" shortcut="⌘O" onClick={onImportVideo} />
            <LauncherAction icon={<Globe size={19} />} title="Vidéo en ligne" detail="YouTube, Internet Archive, Vimeo, streaming…" onClick={onImportOnline} />
            <LauncherAction icon={<FileText size={19} />} title="Scénario Fountain" detail="Importer un fichier .fountain" onClick={onImportFountain} />
            <LauncherAction icon={<Plus size={19} />} title="Projet vide" detail="Écrire d’abord, associer la vidéo ensuite" onClick={onNewProject} />
            <LauncherAction icon={<UploadSimple size={19} />} title="Projet Cinécrique" detail="Importer un export ou une archive" onClick={onImportProject} />
          </div>

          <h2>Bibliothèque</h2>
          <div className="launcher-library" role="group" aria-label="Bibliothèque">
            <button type="button" className={!showArchives ? "active" : ""} aria-pressed={!showArchives} onClick={() => setShowArchives(false)}>
              <FolderOpen size={16} /> Projets <span>{activeCount}</span>
            </button>
            <button type="button" className={showArchives ? "active" : ""} aria-pressed={showArchives} onClick={() => setShowArchives(true)}>
              <Archive size={16} /> Archives <span>{archivedCount}</span>
            </button>
          </div>

          <UpdateCard
            nativeMode={nativeMode}
            appVersion={appVersion}
            updateState={updateState}
            autoUpdate={autoUpdate}
            onAutoUpdateChange={onAutoUpdateChange}
            onCheck={onCheckUpdates}
            onInstall={onInstallUpdate}
            onOpenRelease={onOpenRelease}
          />
        </aside>

        <main className="launcher-main">
          {resume && (
            <section className="launcher-resume" aria-label="Reprendre">
              <button type="button" className="launcher-resume-cover" onClick={() => onOpen(resume.project.id)} aria-label={`Ouvrir ${resume.project.title}`}>
                <ProjectCover project={resume.project} />
              </button>
              <div className="launcher-resume-copy">
                <span className="launcher-eyebrow">Reprendre</span>
                <h1>{resume.project.title}</h1>
                <p>{resume.project.detail}</p>
                <dl>
                  <div><dt>Dernière ouverture</dt><dd>{openedLabel(resume.project.lastOpenedAt)}</dd></div>
                  <div><dt>Analyse</dt><dd>{statsLabel(resumeStats)}</dd></div>
                  <div><dt>Média</dt><dd>{resume.project.path ? resume.project.mediaMissing ? "Introuvable — à relier" : resume.project.source?.kind === "online" ? `Téléchargé · ${resume.project.source.extractor}` : "Fichier local" : resume.project.id.startsWith("demo-") ? "Démonstration" : "Aucune vidéo associée"}</dd></div>
                </dl>
                <button type="button" className="launcher-open" onClick={() => onOpen(resume.project.id)}>Ouvrir le projet <ArrowRight size={16} /></button>
              </div>
            </section>
          )}

          <div className="launcher-grid-heading">
            <h2>{showArchives ? "Archives" : query.trim() ? "Résultats" : "Tous les projets"}</h2>
            <span>{entries.length} projet{entries.length > 1 ? "s" : ""}</span>
          </div>

          {entries.length ? (
            <div className="launcher-grid">
              {entries.map(({ project }) => {
                const stats = projectStats(documents?.[project.id]);
                return (
                  <article
                    key={project.id}
                    className={`launcher-card ${project.id === activeProjectId ? "current" : ""}`}
                    onContextMenu={(event) => onProjectMenu(project.id, event, event.currentTarget.querySelector(".launcher-card-more"))}
                  >
                    <button type="button" className="launcher-card-open" onClick={() => onOpen(project.id)} title={project.archived ? "Restaurer ce projet pour l’ouvrir" : `Ouvrir ${project.title}`}>
                      <ProjectCover project={project} />
                      <span className="launcher-card-copy">
                        <strong>{project.title}</strong>
                        <small>{project.detail}</small>
                        <em>{openedLabel(project.lastOpenedAt)} · {statsLabel(stats)}</em>
                      </span>
                    </button>
                    {project.mediaMissing && <span className="launcher-card-badge warning">Média introuvable</span>}
                    {!project.mediaMissing && project.source?.kind === "online" && <span className="launcher-card-badge">En ligne</span>}
                    <button
                      type="button"
                      className="launcher-card-more"
                      aria-label={`Actions pour ${project.title}`}
                      aria-haspopup="menu"
                      aria-expanded={projectMenuId === project.id}
                      onClick={(event) => onProjectMenu(project.id, event, event.currentTarget)}
                    ><DotsThree size={18} weight="bold" /></button>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="launcher-empty">
              <img src="./assets/cinecrique-mark.svg" alt="" />
              <strong>{showArchives ? "Aucun projet archivé." : query.trim() ? "Aucun projet ne correspond." : "Aucun projet pour l’instant."}</strong>
              {!showArchives && !query.trim() && <span>Commencez par une vidéo locale, une vidéo en ligne ou un scénario Fountain.</span>}
              {query.trim() && <button type="button" onClick={() => onQueryChange("")}>Effacer la recherche</button>}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
