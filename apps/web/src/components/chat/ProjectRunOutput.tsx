import { useAtomValue } from "@effect/atom-react";
import { terminalOutputText } from "@t3tools/client-runtime/state/terminal";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { TerminalIcon } from "lucide-react";
import { useState } from "react";

import { revealThreadTerminal } from "~/lib/revealThreadTerminal";
import { terminalEnvironment } from "~/state/terminal";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { terminalOutputTail } from "./projectRunControl.logic";

const OUTPUT_LINES = 15;

const STATUS_DOT_CLASS = {
  success: "bg-success",
  info: "bg-info",
  warning: "bg-warning",
} as const;

type ProjectRunStatusTone = keyof typeof STATUS_DOT_CLASS;

function RunOutputTail(props: {
  readonly threadRef: ScopedThreadRef;
  readonly terminalId: string;
}) {
  // Mounted only while the popover is open, so it follows the terminal only then.
  const state = AsyncResult.getOrElse(
    useAtomValue(
      terminalEnvironment.observe({
        environmentId: props.threadRef.environmentId,
        input: { threadId: props.threadRef.threadId, terminalId: props.terminalId },
      }),
    ),
    () => null,
  );
  const tail = state ? terminalOutputTail(terminalOutputText(state.output), OUTPUT_LINES) : null;
  return (
    <pre className="max-h-72 min-h-10 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
      {tail?.text ?? (state ? "No output yet." : "Loading output…")}
    </pre>
  );
}

/** The run's status badge; with a terminal to read, it opens the run's last output lines. */
export function ProjectRunStatus(props: {
  readonly tone: ProjectRunStatusTone;
  readonly label: string;
  readonly labelClassName: string;
  readonly threadRef: ScopedThreadRef;
  /** Null when there is no terminal yet or no permission to read it. */
  readonly terminalId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const content = (
    <>
      <span aria-hidden className={`size-1.5 rounded-full ${STATUS_DOT_CLASS[props.tone]}`} />
      <span className={props.labelClassName}>{props.label}</span>
    </>
  );
  const terminalId = props.terminalId;
  if (terminalId === null) return <Badge variant={props.tone}>{content}</Badge>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Badge
            variant={props.tone}
            render={<button type="button" aria-label={`${props.label}. Show output`} />}
          />
        }
      >
        {content}
      </PopoverTrigger>
      <PopoverPopup align="start">
        <div className="flex w-[min(40rem,80vw)] flex-col gap-2">
          <PopoverTitle>Output</PopoverTitle>
          <RunOutputTail threadRef={props.threadRef} terminalId={terminalId} />
          <div className="flex justify-end">
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                setOpen(false);
                revealThreadTerminal(props.threadRef, terminalId);
              }}
            >
              <TerminalIcon />
              Open terminal
            </Button>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
