import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useRef, useState, type ComponentProps } from "react";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import type { HomeFolder } from "../../uiStateStore";
import { cn } from "../../lib/utils";
import { DialogBackdrop } from "../ui/dialog";
import { HOME_GLASS_CLASS } from "./HomeFolderTile";
import { HomeProjectTile } from "./HomeProjectTile";
import { homeFolderMemberKeys } from "./homeFolders.logic";

type TileProps = Omit<ComponentProps<typeof HomeProjectTile>, "dragDisabled" | "groupingTarget">;

const KEYBOARD_SENSOR_OPTIONS = {
  coordinateGetter: sortableKeyboardCoordinates,
  keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
};

function FolderNameInput(props: {
  readonly name: string;
  readonly autoFocus: boolean;
  readonly onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim().length > 0 && draft.trim() !== props.name) {
      props.onRename(draft);
    }
    setDraft(null);
  };
  return (
    <input
      aria-label="Folder name"
      // Focused as it mounts, ahead of focus recovery for the tile the drop removed.
      autoFocus={props.autoFocus}
      value={draft ?? props.name}
      spellCheck={false}
      autoComplete="off"
      className="w-full rounded-xl bg-transparent px-3 py-1.5 text-center text-2xl font-semibold tracking-tight text-foreground outline-none hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      onChange={(event) => setDraft(event.currentTarget.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          commit();
          event.currentTarget.select();
        } else if (event.key === "Escape" && draft !== null) {
          // The first Escape drops the edit; the next one closes the folder.
          event.preventDefault();
          event.stopPropagation();
          setDraft(null);
        }
      }}
    />
  );
}

/** An open Home folder: its members as tiles. Dragging one out of the panel takes it out. */
export function HomeFolderDialog(props: {
  readonly folder: HomeFolder;
  readonly projects: readonly SidebarProjectSnapshot[];
  readonly renaming: boolean;
  readonly tileProps: (project: SidebarProjectSnapshot) => TileProps;
  readonly onRename: (name: string) => void;
  readonly onReorder: (memberKeys: readonly string[]) => void;
  readonly onRemove: (project: SidebarProjectSnapshot) => void;
  readonly onClose: () => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  // A drag out of the panel ends over the viewport; only a press that starts there closes it.
  const backdropPressRef = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const dragged = props.projects.find((project) => project.projectKey === active.id);
    const rect = active.rect.current.translated;
    const panel = popupRef.current?.getBoundingClientRect();
    if (!dragged) return;
    if (rect && panel) {
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x < panel.left || x > panel.right || y < panel.top || y > panel.bottom) {
        props.onRemove(dragged);
        return;
      }
    }
    if (!over || over.id === active.id) return;
    const from = props.projects.indexOf(dragged);
    const to = props.projects.findIndex((project) => project.projectKey === over.id);
    if (to < 0) return;
    const reordered = arrayMove([...props.projects], from, to).flatMap(homeFolderMemberKeys);
    const present = new Set(reordered);
    // Keys of projects not loaded right now keep their place at the end.
    props.onReorder([...reordered, ...props.folder.memberKeys.filter((key) => !present.has(key))]);
  };

  const close = () => {
    // Closing unmounts the name field without a blur; blur first so an edit commits.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && popupRef.current?.contains(focused)) focused.blur();
    props.onClose();
  };

  return (
    <DialogPrimitive.Root
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogBackdrop />
        <DialogPrimitive.Viewport
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          onPointerDown={(event) => {
            backdropPressRef.current = event.target === event.currentTarget;
          }}
          onClick={(event) => {
            if (backdropPressRef.current && event.target === event.currentTarget) close();
            backdropPressRef.current = false;
          }}
        >
          <DialogPrimitive.Popup
            ref={popupRef}
            aria-label={`${props.folder.name} folder`}
            data-slot="dialog-popup"
            initialFocus={() =>
              (props.renaming
                ? popupRef.current?.querySelector<HTMLElement>("input")
                : popupRef.current?.querySelector<HTMLElement>("li button")) ?? true
            }
            className={cn(
              HOME_GLASS_CLASS,
              "flex w-full max-w-3xl flex-col gap-8 rounded-4xl px-8 pt-7 pb-10 text-foreground outline-none transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
            )}
          >
            <FolderNameInput
              name={props.folder.name}
              autoFocus={props.renaming}
              onRename={props.onRename}
            />
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={props.projects.map((project) => project.projectKey)}
                strategy={rectSortingStrategy}
              >
                <ul
                  aria-label={`Projects in ${props.folder.name}`}
                  className="flex flex-wrap justify-center gap-x-6 gap-y-8 sm:gap-x-10"
                >
                  {props.projects.map((project) => (
                    <HomeProjectTile
                      key={project.projectKey}
                      {...props.tileProps(project)}
                      dragDisabled={false}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
