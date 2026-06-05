import { Box, ImageSurface, Text } from "../../ui";
import { colors } from "../../theme/colors";
import { normalizedHttpUrl } from "../../utils/url";

export interface RemoteImageProps {
  src: string;
  alt?: string;
  width: number;
  height?: number;
  label?: string;
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
      <Box flexDirection="column">
        <Text fg={colors.textDim}>{label}</Text>
      </Box>
    </ImageSurface>
  );
}
