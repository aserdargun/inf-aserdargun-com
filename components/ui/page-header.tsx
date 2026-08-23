import type { ReactNode } from "react";

interface PageHeaderProps {
  actions?: ReactNode;
  className?: string;
  description: string;
  title: string;
}

export function PageHeader({ actions, className = "", description, title }: PageHeaderProps) {
  return (
    <header className={`page-header ${className}`.trim()}>
      <div className="page-header__copy">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}
