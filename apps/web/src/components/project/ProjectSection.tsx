import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/** A dashboard card on the project screen. */
export function ProjectSection(props: {
  readonly title: string;
  readonly icon: LucideIcon;
  readonly action?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const Icon = props.icon;
  return (
    <section
      aria-label={props.title}
      className={cn(
        "flex min-w-0 flex-col rounded-2xl border border-border/60 bg-card shadow-xs",
        props.className,
      )}
    >
      <header className="flex min-h-12 shrink-0 items-center gap-2 px-5 pt-3 pb-1">
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="min-w-0 truncate text-sm font-semibold text-foreground">{props.title}</h2>
        {props.action ? (
          <div className="ml-auto flex shrink-0 items-center gap-1">{props.action}</div>
        ) : null}
      </header>
      {props.children}
    </section>
  );
}

/** The quiet message a card shows when it has nothing to list. */
export function ProjectSectionEmpty(props: {
  readonly title: string;
  readonly description?: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 pt-4 pb-7 text-center">
      <p className="text-sm font-medium text-foreground">{props.title}</p>
      {props.description ? (
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
          {props.description}
        </p>
      ) : null}
      {props.children ? <div className="mt-3 flex gap-2">{props.children}</div> : null}
    </div>
  );
}
