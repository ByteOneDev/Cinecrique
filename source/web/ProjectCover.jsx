import { normalizeProjectCover, projectCoverImage, projectCoverText } from "./covers.js";

export function ProjectCover({ project, className = "", decorative = true }) {
  const cover = normalizeProjectCover(project?.cover, project?.poster);
  const image = projectCoverImage(project);
  const text = projectCoverText(project);
  return (
    <div className={`project-cover mode-${cover.mode} ${className}`} aria-label={decorative ? undefined : `Couverture de ${project?.title || "Projet"}`} aria-hidden={decorative || undefined}>
      {image && <img className="project-cover-image" src={image} alt="" />}
      {cover.mode === "text" && <span className={text.length > 28 ? "long" : ""}>{text}</span>}
      {cover.mode === "logo" && <img className="project-cover-logo" src="./assets/cinecrique-mark.svg" alt="" />}
    </div>
  );
}
