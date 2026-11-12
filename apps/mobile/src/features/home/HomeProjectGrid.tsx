import { useState } from "react";
import { Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { useContentTopInset } from "../../components/ui/useBarInset";
import { useWorkspaceTabs } from "../layout/workspace/WorkspaceTabsContext";
import { HomeProjectTile } from "./HomeProjectTile";
import { homeGridColumns, type HomeGridProject } from "./homeProjectGrid.logic";

const GRID_PADDING = 12;
const MIN_TILE_WIDTH = 88;

/** Home's launch view: one tile per project, pinned first, filtered by the list's search. */
export function HomeProjectGrid(props: {
  readonly projects: ReadonlyArray<HomeGridProject>;
  readonly searchQuery: string;
  readonly onOpenProject: (project: HomeGridProject) => void;
  readonly onShowThreads: (() => void) | undefined;
}) {
  const [width, setWidth] = useState(0);
  const workspace = useWorkspaceTabs();
  const insets = useSafeAreaInsets();
  const contentTopInset = useContentTopInset();
  const contentWidth = Math.max(0, width - GRID_PADDING * 2);
  const columns = homeGridColumns(contentWidth, MIN_TILE_WIDTH);
  const tileWidth = contentWidth / columns;
  const iconSize = Math.min(68, Math.max(48, tileWidth - 24));
  const searching = props.searchQuery.trim().length > 0;

  return (
    <ScreenContent surface="screen">
      <ScrollView
        className="flex-1 bg-screen"
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        contentInsetAdjustmentBehavior="never"
        contentInset={Platform.OS === "ios" ? { top: contentTopInset } : undefined}
        contentOffset={Platform.OS === "ios" ? { x: 0, y: -contentTopInset } : undefined}
        automaticallyAdjustsScrollIndicatorInsets={Platform.OS === "ios"}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: GRID_PADDING,
          paddingTop: 16,
          paddingBottom: Math.max(insets.bottom, 24, workspace?.bottomClearance ?? 0),
        }}
      >
        {props.projects.length === 0 ? (
          <EmptyState
            variant="plain"
            title={searching ? "No matching projects" : "No projects yet"}
            detail={
              searching
                ? `No project matches "${props.searchQuery.trim()}".`
                : "Projects from your connected environments show up here."
            }
          />
        ) : width > 0 ? (
          <View className="flex-row flex-wrap" style={{ rowGap: 12 }}>
            {props.projects.map((project) => (
              <HomeProjectTile
                key={project.key}
                project={project}
                width={tileWidth}
                iconSize={iconSize}
                onOpen={props.onOpenProject}
              />
            ))}
          </View>
        ) : null}
        {props.onShowThreads ? (
          <View className="mt-6 items-center">
            <Button
              tone="secondary"
              size="compact"
              icon="text.bubble"
              label={searching ? "Search threads" : "All threads"}
              accessibilityHint={
                searching ? "Searches thread titles and messages" : "Shows every thread as a list"
              }
              onPress={props.onShowThreads}
            />
          </View>
        ) : null}
      </ScrollView>
    </ScreenContent>
  );
}
