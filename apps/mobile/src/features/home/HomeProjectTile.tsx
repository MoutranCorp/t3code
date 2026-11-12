import { useAtomValue } from "@effect/atom-react";
import {
  formatHomeBadgeCount,
  homeProjectAccessibleName,
  homeTileGradient,
  homeTileTintForColor,
} from "@t3tools/client-runtime/home-projects";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { generatedProjectIconSvg } from "@t3tools/shared/generatedProjectIcon";
import {
  getProjectFaviconCacheKey,
  isProjectFaviconFallbackUrl,
} from "@t3tools/shared/projectFavicon";
import { Image } from "expo-image";
import { memo, useState } from "react";
import { Pressable, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop, SvgXml } from "react-native-svg";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText } from "../../components/ui/AppText";
import { projectAutoMonogram, resolveProjectIconSymbol } from "../../lib/projectIcon";
import { projectFaviconUrlAtom } from "../../state/assets";
import type { HomeGridProject } from "./homeProjectGrid.logic";

/** The monogram the name derives, which also picks a fallback tile's colour. */
function autoMonogram(title: string) {
  const glyph = projectAutoMonogram(title);
  return glyph?.kind === "monogram" ? glyph : null;
}

function TileSvg(props: { readonly xml: string; readonly size: number }) {
  // Drawings are sanitized to plain shapes before the server stores them.
  return <SvgXml xml={props.xml} width={props.size * 0.7} height={props.size * 0.7} />;
}

/** A repo favicon keeps its own colours; without one a glyph drawn from the name stands in. */
function AutomaticGlyph(props: { readonly project: EnvironmentProject; readonly size: number }) {
  const { project, size } = props;
  const url = useAtomValue(
    projectFaviconUrlAtom({
      environmentId: project.environmentId,
      cwd: project.workspaceRoot,
      faviconPath: project.faviconPath,
    }),
  );
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (url === null || isProjectFaviconFallbackUrl(url) || url === failedUrl) {
    return <TileSvg xml={generatedProjectIconSvg(project.title)} size={size} />;
  }
  return (
    <Image
      source={
        url.startsWith("data:")
          ? { uri: url }
          : {
              uri: url,
              cacheKey: getProjectFaviconCacheKey(
                project.environmentId,
                project.workspaceRoot,
                url,
              ),
            }
      }
      cachePolicy={url.startsWith("data:") ? "memory" : "memory-disk"}
      contentFit="contain"
      style={{ width: size * 0.56, height: size * 0.56, borderRadius: size * 0.1 }}
      onError={() => setFailedUrl(url)}
    />
  );
}

function TileGlyph(props: { readonly project: EnvironmentProject; readonly size: number }) {
  const { project, size } = props;
  const icon = project.projectIcon;
  if (icon?.kind === "svg") return <TileSvg xml={icon.svg} size={size} />;
  if (icon?.kind === "emoji") {
    return (
      <AppText
        allowFontScaling={false}
        style={{ fontSize: size * 0.5, lineHeight: size * 0.62, includeFontPadding: false }}
      >
        {icon.emoji}
      </AppText>
    );
  }
  const symbol = resolveProjectIconSymbol(icon);
  if (symbol !== null) {
    return (
      <SymbolView
        name={symbol.name}
        size={size * 0.5}
        tintColorClassName="accent-white"
        type="monochrome"
      />
    );
  }
  const text =
    icon?.kind === "monogram"
      ? icon.text
      : icon?.kind === "lucide"
        ? autoMonogram(project.title)?.text
        : undefined;
  if (text !== undefined) {
    return (
      <AppText
        allowFontScaling={false}
        numberOfLines={1}
        className="font-t3-bold"
        style={{ color: "#fff", fontSize: size * 0.36, includeFontPadding: false }}
      >
        {text}
      </AppText>
    );
  }
  return <AutomaticGlyph project={project} size={size} />;
}

const HomeProjectIcon = memo(function HomeProjectIcon(props: {
  readonly project: EnvironmentProject;
  readonly size: number;
  readonly attention: number;
  readonly working: boolean;
}) {
  const { project, size } = props;
  const icon = project.projectIcon;
  const { from, to } = homeTileGradient(
    homeTileTintForColor(
      icon?.kind === "monogram" || icon?.kind === "lucide"
        ? icon.color
        : (autoMonogram(project.title)?.color ?? "blue"),
    ),
  );
  const radius = size * 0.24;
  return (
    <View style={{ width: size, height: size }}>
      <View
        className="items-center justify-center overflow-hidden"
        style={{ width: size, height: size, borderRadius: radius }}
      >
        <Svg width={size} height={size} style={{ position: "absolute" }}>
          <Defs>
            <LinearGradient id="home-tile" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={from} />
              <Stop offset="100%" stopColor={to} />
            </LinearGradient>
          </Defs>
          <Rect width={size} height={size} fill="url(#home-tile)" />
        </Svg>
        <TileGlyph project={project} size={size} />
      </View>
      {props.working ? (
        <View className="absolute -left-1 -top-1 size-3.5 rounded-full border-2 border-screen bg-sky-500" />
      ) : null}
      {props.attention > 0 ? (
        <View className="absolute -right-1.5 -top-1.5 h-6 min-w-6 items-center justify-center rounded-full border-2 border-screen bg-red-500 px-1.5">
          <AppText className="font-t3-bold text-2xs" style={{ color: "#fff" }}>
            {formatHomeBadgeCount(props.attention)}
          </AppText>
        </View>
      ) : null}
    </View>
  );
});

export const HomeProjectTile = memo(function HomeProjectTile(props: {
  readonly project: HomeGridProject;
  readonly width: number;
  readonly iconSize: number;
  readonly onOpen: (project: HomeGridProject) => void;
}) {
  const { project } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={homeProjectAccessibleName(project.displayName, project.badges)}
      accessibilityHint={project.hasThreads ? "Shows the project's threads" : "Starts a new thread"}
      className="items-center gap-1.5 rounded-2xl py-1.5 active:opacity-70"
      style={{ width: props.width }}
      onPress={() => props.onOpen(project)}
    >
      <HomeProjectIcon
        project={project.representative}
        size={props.iconSize}
        attention={project.badges.attention}
        working={project.badges.working}
      />
      <AppText
        textRole="caption"
        numberOfLines={1}
        ellipsizeMode="middle"
        className="font-t3-medium text-foreground"
        style={{ maxWidth: props.width - 4 }}
      >
        {project.displayName}
      </AppText>
      <View className="h-1.5 items-center justify-center">
        {project.badges.appRunning ? (
          <View className="size-1.5 rounded-full bg-emerald-500" />
        ) : null}
      </View>
    </Pressable>
  );
});
