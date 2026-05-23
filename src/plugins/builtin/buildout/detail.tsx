import { Box, ScrollBox } from "../../../ui";
import { EmptyState } from "../../../components";
import type { BuildoutRow } from "./model-types";
import type { InlineTickerCatalog } from "./detail-ui";
import {
  FavoriteCell,
} from "./detail-ui";
import {
  favoriteKey,
  rowStarred,
} from "./table-model";
import { CompanyDetail } from "./detail-company";
import { SiteDetail } from "./detail-site";
import { IntelDetail } from "./detail-intel";

export {
  CompaniesUpgradeCta,
  CompanyCell,
  FavoriteCell,
  tickerBadges,
} from "./detail-ui";

export function BuildoutDetail({
  row,
  width,
  height,
  catalog,
  openTicker,
  canFavorite,
  favoriteBusyKey,
  onToggleFavorite,
}: {
  row: BuildoutRow | null;
  width: number;
  height: number;
  catalog: InlineTickerCatalog;
  openTicker: (symbol: string) => void;
  canFavorite: boolean;
  favoriteBusyKey: string | null;
  onToggleFavorite: (row: BuildoutRow) => void;
}) {
  if (!row) return <EmptyState title="No row selected." />;

  const bodyWidth = Math.max(width - 2, 20);
  const rowFavoriteKey = favoriteKey(row);
  const favoriteToggle = canFavorite && rowFavoriteKey ? (
    <FavoriteCell
      starred={rowStarred(row)}
      busy={favoriteBusyKey === rowFavoriteKey}
      selected={false}
      interactive
      onPress={() => onToggleFavorite(row)}
    />
  ) : null;

  return (
    <ScrollBox width={width} height={height}>
      <Box flexDirection="column" paddingX={1} width={bodyWidth}>
        {row.kind === "company" ? (
          <CompanyDetail
            company={row.item}
            bodyWidth={bodyWidth}
            catalog={catalog}
            openTicker={openTicker}
            favoriteToggle={favoriteToggle}
          />
        ) : null}
        {row.kind === "site" ? (
          <SiteDetail
            site={row.item}
            bodyWidth={bodyWidth}
            height={height}
            catalog={catalog}
            openTicker={openTicker}
            favoriteToggle={favoriteToggle}
          />
        ) : null}
        {row.kind === "intel" ? (
          <IntelDetail
            item={row.item}
            bodyWidth={bodyWidth}
            height={height}
            catalog={catalog}
            openTicker={openTicker}
          />
        ) : null}
      </Box>
    </ScrollBox>
  );
}
