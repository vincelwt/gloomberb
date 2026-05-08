import { Box, ImageSurface, Text } from "../../ui";
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
  const resolvedWidth = Math.max(12, width);
  const imageUrl = normalizedHttpUrl(src);
  if (!imageUrl) return null;

  return (
    <ImageSurface
      src={imageUrl}
      alt={alt}
      width={resolvedWidth}
      height={Math.max(4, height)}
      objectFit="contain"
    >
      <Box flexDirection="column" gap={1}>
        <Text fg={colors.textDim}>{label}</Text>
        <ExternalLinkText
          url={imageUrl}
          label={truncate(imageUrl, resolvedWidth)}
          color={colors.textBright}
        />
      </Box>
    </ImageSurface>
  );
}
