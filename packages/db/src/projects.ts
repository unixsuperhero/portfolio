import type { Database } from "bun:sqlite";
import type { ProjectParent } from "@portfolio/core";

export interface ProjectParentSummary extends ProjectParent { count: number }

export const listProjectParents = (db: Database): ProjectParentSummary[] => db.query<ProjectParentSummary, []>("SELECT project_parents.*, (SELECT count(*) FROM items WHERE items.path LIKE project_parents.path || '/%') count FROM project_parents ORDER BY path").all();
export const addProjectParent = (db: Database, path: string): boolean => db.query("INSERT OR IGNORE INTO project_parents(path) VALUES (?)").run(path).changes > 0;
export const removeProjectParent = (db: Database, id: number): boolean => db.query("DELETE FROM project_parents WHERE id = ?").run(id).changes > 0;
