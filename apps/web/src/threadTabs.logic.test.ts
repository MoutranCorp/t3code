import { describe, expect, it } from "vite-plus/test";

import {
  adjacentThreadTab,
  clampSplitRatio,
  closeThreadTabs,
  EMPTY_THREAD_TABS,
  moveThreadTab,
  mostRecentThreadTab,
  resolveSplitTabKey,
  sanitizeSplitRatio,
  sanitizeThreadTabsState,
  showThreadTabInSplit,
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

  it("swaps panes when the route moves onto the second pane's tab", () => {
    const split = showThreadTabInSplit(visitAll(thread("a"), thread("b")), "env:a");
    expect(visitThreadTab(split, thread("a"), "env:b").split).toBe("env:b");
    // The tab the route left cannot go to the second pane, so the split closes.
    const withDraft = visitThreadTab(split, draft("d", "x"), "env:b");
    expect(visitThreadTab(withDraft, thread("a"), "draft:d").split).toBeNull();
  });
});

describe("resolveSplitTabKey", () => {
  it("shows the tab the route left while the route is on the split's tab", () => {
    expect(resolveSplitTabKey("env:a", "env:b", null)).toBe("env:a");
    expect(resolveSplitTabKey("env:a", "env:a", "env:b")).toBe("env:b");
    expect(resolveSplitTabKey("env:a", "env:a", "draft:d")).toBeNull();
    expect(resolveSplitTabKey("env:a", "env:a", null)).toBeNull();
    expect(resolveSplitTabKey(null, "env:a", "env:b")).toBeNull();
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

  it("keeps the main pane off the second pane's tab, and promotes it as the last one left", () => {
    const split = showThreadTabInSplit(state, "env:c");
    const result = closeThreadTabs(split, ["env:b"], shown, "env:b");
    expect(result.next?.key).toBe("env:a");
    expect(result.state.split).toBe("env:c");
    const last = closeThreadTabs(split, ["env:a", "env:b"], shown, "env:b");
    expect(last.next?.key).toBe("env:c");
    expect(last.state.split).toBeNull();
  });

  it("moves a closing second pane to a neighbour it can show, or closes it", () => {
    const withDraft = visitThreadTab(state, draft("d", "x"));
    const split = showThreadTabInSplit(withDraft, "env:b");
    const shownWithDraft = [...shown, "draft:d"];
    // Not env:a, which the main pane shows, and never a draft.
    expect(closeThreadTabs(split, ["env:b"], shownWithDraft, "env:a").state.split).toBe("env:c");
    expect(
      closeThreadTabs(split, ["env:b", "env:c"], shownWithDraft, "env:a").state.split,
    ).toBeNull();
    expect(closeThreadTabs(split, ["env:b"], shownWithDraft, "env:a").next).toBeUndefined();
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

describe("showThreadTabInSplit and split ratios", () => {
  it("opens only a thread tab in the second pane and brings it forward", () => {
    const state = visitAll(thread("a"), draft("d", "x"));
    expect(showThreadTabInSplit(state, "draft:d")).toBe(state);
    expect(showThreadTabInSplit(state, "env:gone")).toBe(state);
    const split = showThreadTabInSplit(state, "env:a");
    expect(split.split).toBe("env:a");
    expect(split.recent[0]).toBe("env:a");
  });

  it("keeps both panes at their minimum width, and evens them when both cannot fit", () => {
    expect(clampSplitRatio(0.1, 1000, 300)).toBe(0.3);
    expect(clampSplitRatio(0.9, 1000, 300)).toBe(0.7);
    expect(clampSplitRatio(0.6, 1000, 300)).toBe(0.6);
    expect(clampSplitRatio(0.2, 500, 300)).toBe(0.5);
    expect(sanitizeSplitRatio(0.95)).toBe(0.5);
    expect(sanitizeSplitRatio("0.4")).toBe(0.5);
    expect(sanitizeSplitRatio(0.4)).toBe(0.4);
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
        split: "draft:d",
      }),
    ).toEqual({
      tabs: [
        { key: "env:a", target: thread("a") },
        { key: "draft:d", target: draft("d", "t") },
      ],
      recent: ["draft:d"],
      closed: [{ key: "env:z", target: thread("z") }],
      split: null,
    });
    expect(sanitizeThreadTabsState({ tabs: [{ target: thread("a") }], split: "env:a" }).split).toBe(
      "env:a",
    );
    expect(sanitizeThreadTabsState(null)).toBe(EMPTY_THREAD_TABS);
  });
});
