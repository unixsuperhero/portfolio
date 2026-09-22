import type { ReactNode } from "react";
import { kindLabel } from "@portfolio/core";
import type { ItemType } from "@portfolio/core";

/** The small mono badge that says DOC, NOTE, LINK, PR, FILE, or DIR. */
export const KindBadge = ({ type, className = "" }: { type: ItemType | string; className?: string }) => <span className={`kind ${className}`.trim()}>{kindLabel(type)}</span>;

export interface TagProps { name: string; href?: string; onClick?: (name: string) => void; children?: ReactNode }

/** A tag pill: a link when `href` is set, a button when `onClick` is set, otherwise plain. */
export function Tag({ name, href, onClick, children }: TagProps) {
  const content = children ?? name;
  if (href) return <a className="tag" href={href}>{content}</a>;
  if (onClick) return <button type="button" className="tag" onClick={() => onClick(name)}>{content}</button>;
  return <span className="tag">{content}</span>;
}

export interface TagListProps { tags: string[]; hrefFor?: (name: string) => string; onClick?: (name: string) => void; className?: string }

export function TagList({ tags, hrefFor, onClick, className = "tag-list" }: TagListProps) {
  if (!tags.length) return null;
  return <div className={className}>{tags.map(tag => <Tag key={tag} name={tag} href={hrefFor?.(tag)} onClick={onClick} />)}</div>;
}

export const EmptyState = ({ title, hint, className = "empty" }: { title: string; hint?: string; className?: string }) => <div className={className}><strong>{title}</strong>{hint ? <span>{hint}</span> : null}</div>;
