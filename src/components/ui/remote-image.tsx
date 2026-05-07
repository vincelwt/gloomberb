import { Box, ImageSurface, Text, useUiHost } from "../../ui";
import { colors } from "../../theme/colors";
import { ExternalLinkText } from "./external-link";
import { normalizedHttpUrl } from "../../utils/url";

export interface RemoteImageProps {
  src: string;
  alt?: string;
  width: number;
  height?: number;
  label?: string;
}

function truncate(value: string, width: number): string {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width <= 3) return value.slice(0, width);
  return `${value.slice(0, width - 3)}...`;
}

export function RemoteImage({
  src,
  alt = "Image",
  width,
  height = 12,
  label = "image",
}: RemoteImageProps) {
  const ui = useUiHost();
  const resolvedWidth = Math.max(12, width);
  const imageUrl = normalizedHttpUrl(src);
  if (!imageUrl) return null;

  if (ui.kind === "desktop-web") {
    return (
      <ImageSurface
        src={imageUrl}
        alt={alt}
        width={resolvedWidth}
        height={Math.max(4, height)}
        border
        borderColor={colors.border}
        backgroundColor={colors.panel}
        objectFit="contain"
      >
        <Box paddingX={1} paddingY={1} flexDirection="column" gap={1}>
          <Text fg={colors.textDim}>{label}</Text>
          <ExternalLinkText
            url={imageUrl}
            label={truncate(imageUrl, Math.max(1, resolvedWidth - 2))}
            color={colors.textBright}
          />
        </Box>
      </ImageSurface>
    );
  }

  return (
    <Box
      width={resolvedWidth}
      minHeight={2}
      border
      borderColor={colors.border}
      backgroundColor={colors.panel}
      paddingX={1}
      flexDirection="column"
    >
      <Text fg={colors.textDim}>{label}</Text>
      <ExternalLinkText
        url={imageUrl}
        label={truncate(imageUrl, Math.max(1, resolvedWidth - 2))}
        color={colors.textBright}
      />
    </Box>
  );
}
