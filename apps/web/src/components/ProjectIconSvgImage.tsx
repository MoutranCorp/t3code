import { cn } from "~/lib/utils";

/** An image, not inline markup, so a stored drawing can never run script or load anything. */
export function ProjectIconSvgImage(props: {
  readonly svg: string;
  readonly className?: string | undefined;
}) {
  return (
    <img
      alt=""
      aria-hidden
      draggable={false}
      src={`data:image/svg+xml,${encodeURIComponent(props.svg)}`}
      className={cn("pointer-events-none select-none", props.className)}
    />
  );
}
