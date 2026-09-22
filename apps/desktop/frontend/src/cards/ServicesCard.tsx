import { useEffect, useState } from "react";
import type { ProjectView } from "../types.ts";
import { getProject } from "../api.ts";
import { openTerminal } from "../terminal/store.ts";

export function ServicesCard({ projectId }: { projectId: number }) {
  const [project, setProject] = useState<ProjectView | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});

  useEffect(() => { getProject(projectId).then(setProject).catch(() => setProject(null)); }, [projectId]);

  if (!project) return <div className="empty"><strong>Loading…</strong></div>;
  const scripts = Object.entries(project.services.scripts ?? {});
  if (!scripts.length) return <div className="empty"><strong>No scripts.</strong></div>;

  const run = (name: string, command: string) => {
    const extra = args[name] ?? "";
    openTerminal({ cwd: project.path, command: extra ? `${command} ${extra}` : command, title: `${project.title}: ${name}` });
  };

  return (
    <div>
      {scripts.map(([name, command]) => (
        <div className="service-row" key={name}>
          <strong>{name}</strong>
          <input className="args" placeholder="args" value={args[name] ?? ""} onChange={event => setArgs(current => ({ ...current, [name]: event.target.value }))} />
          <button type="button" className="secondary" onClick={() => run(name, command)}>Run</button>
        </div>
      ))}
    </div>
  );
}
