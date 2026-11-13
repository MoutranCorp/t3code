import { describe, expect, it } from "vite-plus/test";

import { opensRightPanel, opensTerminalDrawer } from "./threadSplit.logic";

const panel = (isOpen: boolean, activeSurfaceId: string | null, surfaces: string[]) => ({
  isOpen,
  activeSurfaceId,
  surfaces,
});
const drawer = (terminalOpen: boolean, activeTerminalId: string, terminalIds: string[]) => ({
  terminalOpen,
  activeTerminalId,
  terminalIds,
});

describe("opensRightPanel", () => {
  it("counts opening the panel, another tab, or a new one", () => {
    expect(opensRightPanel(undefined, panel(true, "diff", ["diff"]))).toBe(true);
    expect(opensRightPanel(panel(false, "diff", ["diff"]), panel(true, "diff", ["diff"]))).toBe(
      true,
    );
    expect(
      opensRightPanel(panel(true, "diff", ["diff", "file"]), panel(true, "file", ["diff", "file"])),
    ).toBe(true);
    expect(
      opensRightPanel(panel(true, "diff", ["diff"]), panel(true, "file", ["diff", "file"])),
    ).toBe(true);
  });

  it("ignores closing the panel or its tabs", () => {
    expect(opensRightPanel(panel(true, "diff", ["diff"]), panel(false, "diff", ["diff"]))).toBe(
      false,
    );
    expect(
      opensRightPanel(panel(true, "file", ["diff", "file"]), panel(true, "diff", ["diff"])),
    ).toBe(false);
    expect(opensRightPanel(panel(true, "diff", ["diff"]), undefined)).toBe(false);
  });
});

describe("opensTerminalDrawer", () => {
  it("counts opening the drawer or switching to another or a new terminal, not closing it", () => {
    expect(opensTerminalDrawer(undefined, drawer(true, "a", ["a"]))).toBe(true);
    expect(opensTerminalDrawer(drawer(true, "a", ["a"]), drawer(true, "b", ["a", "b"]))).toBe(true);
    expect(opensTerminalDrawer(drawer(true, "a", ["a"]), drawer(false, "a", ["a"]))).toBe(false);
    expect(opensTerminalDrawer(drawer(false, "a", ["a"]), drawer(false, "a", ["a", "b"]))).toBe(
      false,
    );
  });
});
