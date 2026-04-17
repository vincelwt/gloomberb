import { Box, Text } from "../../ui";
import { useCallback, useMemo, useState } from "react";
import { type BoxRenderable } from "../../ui";
import { colors } from "../../theme/colors";
import { useKittyImage, type KittyImagePlacement } from "./use-kitty-image";

interface KittyThumbnailProps {
  imageUrl?: string;
  width: number;
  height: number;
  fallbackText?: string;
}

export function KittyThumbnail({ imageUrl, width, height, fallbackText }: KittyThumbnailProps) {
  const [position, setPosition] = useState<{ col: number; row: number } | null>(null);

  const refCallback = useCallback((node: BoxRenderable | null) => {
    if (!node) {
      setPosition(null);
      return;
    }
    // Kitty uses 1-based coordinates
    setPosition({ col: node.x + 1, row: node.y + 1 });
  }, []);

  const placement = useMemo<KittyImagePlacement | null>(
    () => position ? { col: position.col, row: position.row, cols: width, rows: height } : null,
    [position, width, height],
  );

  useKittyImage(imageUrl, placement);

  // Reserve layout space; kitty renders on top
  return (
    <Box ref={refCallback} width={width} height={height}>
      {fallbackText && (
        <Text fg={colors.textMuted}>{fallbackText}</Text>
      )}
    </Box>
  );
}
