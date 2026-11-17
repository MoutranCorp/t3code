import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

export function T3Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  const aspectRatio = 38 / 57;
  return (
    <Svg
      accessibilityLabel="Facio"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="0 0 38 57"
    >
      <ThemedPath
        d="M0 0H38V10.56H13V23.2H34V33.76H13V57H0Z"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
    </Svg>
  );
}
