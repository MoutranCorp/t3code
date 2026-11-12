import { FolderInputIcon, FolderPlusIcon, PlusIcon, LightbulbIcon } from "lucide-react";

import { openCommandPalette } from "../../commandPaletteBus";
import { cn } from "../../lib/utils";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { RunningDot, TILE_BUTTON_CLASS } from "./HomeProjectTile";

export function HomeNewProjectTile(props: {
  readonly onDescribe: () => void;
  readonly onImport: () => void;
}) {
  return (
    <li className="flex justify-center">
      <Menu>
        <MenuTrigger
          render={<button type="button" />}
          className={cn(TILE_BUTTON_CLASS, "w-24 gap-2 sm:w-28")}
        >
          <span className="flex size-20 items-center justify-center rounded-2xl border-2 border-dashed border-muted-foreground/35 text-muted-foreground motion-safe:transition-colors group-hover/home-tile:border-muted-foreground/70 group-hover/home-tile:text-foreground sm:size-24 sm:rounded-3xl">
            <PlusIcon aria-hidden className="size-8" />
          </span>
          <span className="text-sm font-medium text-muted-foreground">New project</span>
          <RunningDot appRunning={false} />
        </MenuTrigger>
        <MenuPopup align="center" side="bottom">
          <MenuItem onClick={props.onDescribe}>
            <LightbulbIcon aria-hidden />
            Describe a new project…
          </MenuItem>
          <MenuItem onClick={() => openCommandPalette({ open: "add-project" })}>
            <FolderPlusIcon aria-hidden />
            Add existing folder…
          </MenuItem>
          <MenuItem onClick={props.onImport}>
            <FolderInputIcon aria-hidden />
            Import from a folder…
          </MenuItem>
        </MenuPopup>
      </Menu>
    </li>
  );
}
