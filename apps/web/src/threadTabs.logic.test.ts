import { describe, expect, it } from "vite-plus/test";

import {
  adjacentThreadTab,
  closeThreadTabs,
  EMPTY_THREAD_TABS,
  moveThreadTab,
  mostRecentThreadTab,
  sanitizeThreadTabsState,
  takeClosedThreadTab,
  type ThreadTabsState,
  type ThreadTabTarget,
  visitThreadTab,
} from "./threadTabs.logic";

const thread = (threadId: string): ThreadTabTarget => ({
  kind: "thread",
  environmentId: "env",
  threadId,
});
const draft = (draftId: string, threadId: string): ThreadTabTarget => ({
  kind: "draft",
  draftId,
  threadId,
});
const visitAll = (...targets: ThreadTabTarget[]) =>
  targets.reduce<ThreadTabsState>(
    (state, target) => visitThreadTab(state, target),
    EMPTY_THREAD_TABS,
  );
const keys = (state: ThreadTabsState) => state.tabs.map((tab) => tab.key);

describe("visitThreadTab", () => {
  it("appends new tabs, brings visited ones forward, and keeps a revisit a no-op", () => {
    const state = visitAll(thread("a"), thread("b"), thread("a"));
    expect(keys(state)).toEqual(["env:a", "env:b"]);
    expect(state.recent).toEqual(["env:a", "env:b"]);
    expect(visitThreadTab(state, thread("a"))).toBe(state);
  });

  it("turns a sent draft's tab into its thread in place", () => {
    const state = visitAll(thread("a"), draft("d1", "new"), thread("b"), thread("new"));
    expect(keys(state)).toEqual(["env:a", "env:new", "env:b"]);
    expect(state.recent).toEqual(["env:new", "env:b", "env:a"]);
  });

  it("drops the least recently active tabs past the cap", () => {
    let state = EMPTY_THREAD_TABS;
    for (let index = 0; index < 41; index += 1) state = visitThreadTab(state, thread(`t${index}`));
    expect(state.tabs).toHaveLength(40);
    expect(keys(state)).not.toContain("env:t0");
    expect(state.recent[0]).toBe("env:t40");
  });
});

describe("closeThreadTabs", () => {
  const state = visitAll(thread("a"), thread("b"), thread("c"));
  const shown = ["env:a", "env:b", "env:c"];

  it("shows the right neighbour, else the left one, else nothing", () => {
    expect(closeThreadTabs(state, ["env:b"], shown, "env:b").next?.key).toBe("env:c");
    expect(closeThreadTabs(state, ["env:c"], shown, "env:c").next?.key).toBe("env:b");
    expect(closeThreadTabs(state, ["env:a", "env:b", "env:c"], shown, "env:b").next).toBeNull();
  });

  it("leaves navigation alone when the shown tab stays open, and remembers closed tabs", () => {
    const result = closeThreadTabs(state, ["env:a", "env:b"], shown, "env:c");
    expect(result.next).toBeUndefined();
    expect(keys(result.state)).toEqual(["env:c"]);
    expect(result.state.recent).toEqual(["env:c"]);
    expect(result.state.closed.map((tab) => tab.key)).toEqual(["env:b", "env:a"]);
  });

  it("skips hidden tabs when picking the neighbour", () => {
    // env:c is open but hidden, such as an archived thread.
    expect(closeThreadTabs(state, ["env:b"], ["env:a", "env:b"], "env:b").next?.key).toBe("env:a");
  });
});

describe("takeClosedThreadTab", () => {
  it("reopens the latest closed tab that can still open, and a visit forgets it", () => {
    const { state } = closeThreadTabs(
      visitAll(thread("a"), thread("b"), thread("c")),
      ["env:a", "env:b"],
      ["env:a", "env:b", "env:c"],
      "env:c",
    );
    const taken = takeClosedThreadTab(state, (tab) => tab.key !== "env:b");
    expect(taken.tab?.key).toBe("env:a");
    expect(taken.state.closed.map((tab) => tab.key)).toEqual(["env:b"]);
    expect(visitThreadTab(state, thread("b")).closed.map((tab) => tab.key)).toEqual(["env:a"]);
  });
});

describe("moveThreadTab and adjacentThreadTab", () => {
  it("moves a tab onto another's slot and steps through tabs, wrapping", () => {
    const state = visitAll(thread("a"), thread("b"), thread("c"));
    expect(keys(moveThreadTab(state, "env:a", "env:c"))).toEqual(["env:b", "env:c", "env:a"]);
    expect(adjacentThreadTab(state.tabs, "env:c", 1)?.key).toBe("env:a");
    expect(adjacentThreadTab(state.tabs, "env:a", -1)?.key).toBe("env:c");
    expect(adjacentThreadTab(state.tabs, null, -1)?.key).toBe("env:c");
  });

  it("finds the most recently active of a project's tabs", () => {
    const state = visitAll(thread("a"), thread("b"), thread("c"), thread("a"));
    expect(mostRecentThreadTab(state.recent, [state.tabs[1]!, state.tabs[2]!])?.key).toBe("env:c");
  });
});

describe("sanitizeThreadTabsState", () => {
  it("drops malformed and duplicate tabs and recents of tabs that are not open", () => {
    expect(
      sanitizeThreadTabsState({
        tabs: [
          { target: thread("a") },
          { target: thread("a") },
          { target: { kind: "thread", environmentId: "", threadId: "x" } },
          { target: draft("d", "t") },
          "junk",
        ],
        recent: ["draft:d", "env:gone", 3],
        closed: [{ target: thread("a") }, { target: thread("z") }],
      }),
    ).toEqual({
      tabs: [
        { key: "env:a", target: thread("a") },
        { key: "draft:d", target: draft("d", "t") },
      ],
      recent: ["draft:d"],
      closed: [{ key: "env:z", target: thread("z") }],
    });
    expect(sanitizeThreadTabsState(null)).toBe(EMPTY_THREAD_TABS);
  });
});
