interface PanelState {
  readonly isOpen: boolean;
  readonly activeSurfaceId: string | null;
  readonly surfaces: readonly unknown[];
}

interface DrawerState {
  readonly terminalOpen: boolean;
  readonly activeTerminalId: string;
  readonly terminalIds: readonly string[];
}

/**
 * Whether a write opened something in a thread's right panel: the panel itself, another tab, or
 * a new one. Closing tabs, which reconciling a missing workspace does, opens nothing.
 */
export function opensRightPanel(
  previous: PanelState | undefined,
  next: PanelState | undefined,
): boolean {
  if (next === undefined || !next.isOpen || next === previous) return false;
  if (previous === undefined || !previous.isOpen) return true;
  return (
    next.surfaces.length > previous.surfaces.length ||
    (next.activeSurfaceId !== previous.activeSurfaceId &&
      next.surfaces.length === previous.surfaces.length)
  );
}

/** Whether a write opened a thread's terminal drawer, or another or a new terminal in it. */
export function opensTerminalDrawer(
  previous: DrawerState | undefined,
  next: DrawerState | undefined,
): boolean {
  if (next === undefined || !next.terminalOpen || next === previous) return false;
  if (previous === undefined || !previous.terminalOpen) return true;
  return (
    next.terminalIds.length > previous.terminalIds.length ||
    next.activeTerminalId !== previous.activeTerminalId
  );
}
