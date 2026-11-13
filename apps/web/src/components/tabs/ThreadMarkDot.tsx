import { cn } from "../../lib/utils";
import { THREAD_MARK_LABEL, type ThreadMark } from "./threadTabsView.logic";

const MARK_DOT_CLASS: Record<ThreadMark, string> = {
  "needs-you": "bg-warning",
  error: "bg-error",
  working: "bg-info",
  done: "bg-success",
};

/** A static dot: a pulsing one would repaint every frame on every screen. */
export function ThreadMarkDot(props: { readonly mark: ThreadMark; readonly className?: string }) {
  return (
    <span
      className={cn(
        "rounded-full ring-2 ring-background",
        MARK_DOT_CLASS[props.mark],
        props.className,
      )}
    >
      <span className="sr-only">{THREAD_MARK_LABEL[props.mark]}</span>
    </span>
  );
}
