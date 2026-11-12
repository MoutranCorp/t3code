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
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { HomeProjectTile } from "./HomeProjectTile";
import { homeFolderMemberKeys } from "./homeFolders.logic";

type TileProps = Omit<ComponentProps<typeof HomeProjectTile>, "dragDisabled" | "groupingTarget">;

const KEYBOARD_SENSOR_OPTIONS = {
  coordinateGetter: sortableKeyboardCoordinates,
  keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
};

function FolderNameInput(props: {
  readonly name: string;
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
    <DialogTitle
      render={
        <input
          aria-label="Folder name"
          value={draft ?? props.name}
          spellCheck={false}
          autoComplete="off"
          className="w-full rounded-lg bg-transparent px-2 py-1 text-center text-xl font-semibold text-foreground outline-none hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape" && draft !== null) {
              // The first Escape drops the edit; the next one closes the folder.
              event.preventDefault();
              event.stopPropagation();
              setDraft(null);
            }
          }}
        />
      }
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
  const listRef = useRef<HTMLUListElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const dragged = props.projects.find((project) => project.projectKey === active.id);
    const rect = active.rect.current.translated;
    const panel = listRef.current
      ?.closest<HTMLElement>('[data-slot="dialog-popup"]')
      ?.getBoundingClientRect();
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

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup
        className="sm:max-w-2xl"
        bottomStickOnMobile={false}
        showCloseButton={false}
        initialFocus={() =>
          props.renaming
            ? (listRef.current
                ?.closest("[data-slot=dialog-popup]")
                ?.querySelector<HTMLElement>("input[aria-label='Folder name']") ?? true)
            : (listRef.current?.querySelector<HTMLElement>("button") ?? true)
        }
      >
        <div className="flex flex-col gap-6 p-6">
          <FolderNameInput name={props.folder.name} onRename={props.onRename} />
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
                ref={listRef}
                aria-label={`Projects in ${props.folder.name}`}
                className="flex flex-wrap justify-center gap-x-6 gap-y-6 sm:gap-x-8"
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
          <p className="text-center text-xs text-muted-foreground">
            Drag a project out of the folder to put it back on Home.
          </p>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
