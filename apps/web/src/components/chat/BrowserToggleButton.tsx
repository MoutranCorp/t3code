import { GlobeIcon } from "lucide-react";
import { memo } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

/** The browser's own button in the thread header, so opening it never needs a menu or a shortcut. */
export const BrowserToggleButton = memo(function BrowserToggleButton(props: {
  readonly open: boolean;
  readonly shortcutLabel: string | null;
  readonly onToggle: () => void;
}) {
  const action = props.open ? "Close browser" : "Open browser";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant={props.open ? "secondary" : "outline"}
            aria-label={action}
            aria-pressed={props.open ? "true" : "false"}
            onClick={props.onToggle}
          />
        }
      >
        <GlobeIcon />
        <span className="sr-only @md/chat-header:not-sr-only">Browser</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {props.shortcutLabel ? `${action} (${props.shortcutLabel})` : action}
      </TooltipPopup>
    </Tooltip>
  );
});
