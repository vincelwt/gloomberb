import { Box, Text } from "../../../../ui";
import { RemoteImage } from "../../../../components/ui";
import { colors } from "../../../../theme/colors";
import type { BuildoutObservation, BuildoutSite } from "../model/types";
import { dateShort } from "../format";

function observationImageUrl(observation: BuildoutObservation) {
  return observation.upscaledImageUrl
    ?? observation.imageUrl
    ?? observation.originalImageUrl
    ?? observation.swirImageUrl
    ?? observation.nirImageUrl
    ?? null;
}

function pickObservationImages(observations: readonly BuildoutObservation[]) {
  const seen = new Set<string>();
  const preferred = [
    observations.find((item) => item.observationSource === "sentinel2" && observationImageUrl(item)),
    observations.find((item) => item.observationSource === "sentinel1" && observationImageUrl(item)),
    ...observations.filter((item) => observationImageUrl(item)),
  ].filter((item): item is BuildoutObservation => item != null);

  return preferred.filter((item) => {
    const url = observationImageUrl(item);
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  }).slice(0, 2);
}

export function SiteSatelliteImages({
  site,
  width,
  height,
}: {
  site: BuildoutSite;
  width: number;
  height: number;
}) {
  const observations = site.observations ?? [];
  if (observations.length === 0) return null;

  const imageWidth = Math.max(20, Math.min(width, 96));
  const imageHeight = Math.max(6, Math.min(18, Math.floor(height / 3)));
  const imageObservations = pickObservationImages(observations);

  if (imageObservations.length === 0) {
    return (
      <Box marginTop={1} flexDirection="column">
        <Text fg={colors.textDim}>Satellite Observations</Text>
        <Text fg={colors.textMuted}>
          {`${observations.length} captures available. Image URLs require pro access.`}
        </Text>
      </Box>
    );
  }

  return (
    <Box marginTop={1} flexDirection="column" gap={1}>
      <Text fg={colors.textDim}>Satellite Observations</Text>
      {imageObservations.map((observation, index) => {
        const url = observationImageUrl(observation);
        if (!url) return null;
        const source = observation.observationSource === "sentinel1" ? "Radar" : "Optical";
        const label = `${source} ${dateShort(observation.captureDate)}`;
        return (
          <RemoteImage
            key={observation.id ?? `${url}:${index}`}
            src={url}
            alt={`${site.name} satellite observation`}
            width={imageWidth}
            height={imageHeight}
            label={label}
          />
        );
      })}
    </Box>
  );
}
