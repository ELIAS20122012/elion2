import type { ReactNode } from "react";

/**
 * Header inside a page. The page title already sits in the top bar, so by default it is kept only for screen
 * readers and the visible part is the one-line description plus the actions. Pass `showTitle` for a hero page.
 */
export default function PageHeader({ title, subtitle, actions, showTitle = false }: { title: string; subtitle?: string; actions?: ReactNode; showTitle?: boolean }) {
  return (
    <header className="page-head">
      <div>
        <h2 className={showTitle ? "" : "sr-only"}>{title}</h2>
        {subtitle && <p className={showTitle ? "" : "lead"}>{subtitle}</p>}
      </div>
      {actions && <div className="head-actions">{actions}</div>}
    </header>
  );
}
