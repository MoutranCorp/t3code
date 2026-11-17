import { createContext } from "react";

/**
 * True for a thread kept mounted under Settings or Usage, shown as a side chat in its parent's
 * panel, or in the split view pane without focus; its global shortcuts and listeners stand down.
 */
export const BackgroundThreadContext = createContext(false);

/**
 * True for the split view pane without focus. Unlike a background thread it stays interactive,
 * so it only gives up claiming focus to the pane that has it.
 */
export const InactiveThreadPaneContext = createContext(false);
/** True only for a thread kept mounted out of sight under Settings or Usage. */
export const HiddenThreadContext = createContext(false);
