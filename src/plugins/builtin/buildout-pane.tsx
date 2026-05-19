import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, ScrollBox, Text, TextAttributes } from "../../ui";
import {
  DataTableStackView,
  EmptyState,
  Spinner,
  Tabs,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../components";
import type { PaneProps } from "../../types/plugin";
import { colors } from "../../theme/colors";
import { apiClient } from "../../utils/api-client";
import { formatTimeAgo } from "../../utils/format";
import { httpFetch } from "../../utils/http-transport";
import { InlineAuthActions } from "./cloud-auth-actions";

const BUILDOUT_API_URL = "https://api.thebuildout.ai";

type BuildoutTabId = "companies" | "sites" | "intel";
type SortDirection = "asc" | "desc";

type BuildoutCompany = {
  id: string;
  name: string;
  ticker?: string | null;
  exchange?: string | null;
  description?: string | null;
  longDescription?: string | null;
  primarySector?: string | null;
  primarySubsector?: string | null;
  primaryTechnology?: string | null;
  aiCriticality?: string | null;
  marketCap?: string | null;
  revenue?: string | null;
  revenueGrowthYoy?: string | null;
  lastQuarterGrowth?: string | null;
  countryHq?: string | null;
  sites?: Array<{ name?: string; type?: string; relationship?: string }>;
};

type BuildoutSite = {
  id: string;
  name: string;
  type?: string | null;
  ownerName?: string | null;
  ownerTicker?: string | null;
  address?: string | null;
  location?: { city?: string | null; country?: string | null };
  constructionActivity?: number | null;
  parkingActivity?: number | null;
  latestCapture?: string | null;
  powerCapacity?: string | null;
  eta?: string | null;
  description?: string | null;
  builders?: Array<{ companyName?: string; companyTicker?: string | null; role?: string | null }>;
};

type BuildoutUpdate = {
  id: string;
  headline: string;
  content?: string | null;
  context?: string | null;
  type?: string | null;
  publishedAt?: string | null;
  verificationStatus?: string | null;
  companies?: Array<{ name?: string; ticker?: string | null }>;
};

type BuildoutRow =
  | { kind: "company"; item: BuildoutCompany }
  | { kind: "site"; item: BuildoutSite }
  | { kind: "intel"; item: BuildoutUpdate };

type BuildoutLoadState =
  | { status: "loading" }
  | { status: "auth" }
  | { status: "inactive" }
  | { status: "error"; message: string }
  | {
    status: "ready";
    companies: BuildoutCompany[];
    sites: BuildoutSite[];
    intel: BuildoutUpdate[];
    loadedAt: number;
  };

type BuildoutColumn = DataTableColumn & {
  id:
    | "company"
    | "sector"
    | "criticality"
    | "marketCap"
    | "revenue"
    | "growth"
    | "site"
    | "type"
    | "owner"
    | "location"
    | "construction"
    | "capture"
    | "time"
    | "companies"
    | "headline";
};

const tabs: Array<{ label: string; value: BuildoutTabId }> = [
  { label: "Companies", value: "companies" },
  { label: "Sites", value: "sites" },
  { label: "Intel", value: "intel" },
];

const companyColumns: BuildoutColumn[] = [
  { id: "company", label: "Company", width: 24, align: "left", flexGrow: 2 },
  { id: "sector", label: "Sector", width: 18, align: "left", flexGrow: 1 },
  { id: "criticality", label: "Crit", width: 10, align: "left" },
  { id: "marketCap", label: "Mkt Cap", width: 10, align: "right" },
  { id: "revenue", label: "Revenue", width: 10, align: "right" },
  { id: "growth", label: "Growth", width: 10, align: "right" },
];

const siteColumns: BuildoutColumn[] = [
  { id: "site", label: "Site", width: 26, align: "left", flexGrow: 2 },
  { id: "type", label: "Type", width: 14, align: "left" },
  { id: "owner", label: "Owner", width: 20, align: "left", flexGrow: 1 },
  { id: "location", label: "Location", width: 18, align: "left", flexGrow: 1 },
  { id: "construction", label: "Const", width: 8, align: "right" },
  { id: "capture", label: "Last Sat", width: 12, align: "left" },
];

const intelColumns: BuildoutColumn[] = [
  { id: "time", label: "Time", width: 12, align: "left" },
  { id: "companies", label: "Companies", width: 22, align: "left", flexGrow: 1 },
  { id: "headline", label: "Headline", width: 48, align: "left", flexGrow: 3 },
];

function truncate(text: string, width: number) {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

function text(value: unknown, fallback = "-") {
  if (value == null) return fallback;
  const stringValue = String(value).trim();
  return stringValue || fallback;
}

function dateShort(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toISOString().slice(0, 10);
}

function activityLabel(value: number | null | undefined) {
  if (value == null) return "-";
  if (value >= 2) return "High";
  if (value >= 1) return "Low";
  return "None";
}

function rowKey(row: BuildoutRow) {
  return `${row.kind}:${row.item.id}`;
}

function activeRows(state: BuildoutLoadState, activeTab: BuildoutTabId): BuildoutRow[] {
  if (state.status !== "ready") return [];
  if (activeTab === "companies") {
    return state.companies.map((item) => ({ kind: "company", item }));
  }
  if (activeTab === "sites") {
    return state.sites.map((item) => ({ kind: "site", item }));
  }
  return state.intel.map((item) => ({ kind: "intel", item }));
}

function columnsForTab(activeTab: BuildoutTabId) {
  if (activeTab === "companies") return companyColumns;
  if (activeTab === "sites") return siteColumns;
  return intelColumns;
}

function compareStrings(left: string, right: string, direction: SortDirection) {
  const result = left.localeCompare(right);
  return direction === "asc" ? result : -result;
}

function sortValue(row: BuildoutRow, columnId: string) {
  const item = row.item as Record<string, unknown>;
  switch (columnId) {
    case "company":
    case "site":
      return text(item.name, "");
    case "headline":
      return text((row.item as BuildoutUpdate).headline, "");
    case "sector":
      return text((row.item as BuildoutCompany).primarySector, "");
    case "criticality":
      return text((row.item as BuildoutCompany).aiCriticality, "");
    case "owner":
      return text((row.item as BuildoutSite).ownerTicker ?? (row.item as BuildoutSite).ownerName, "");
    case "time":
      return text((row.item as BuildoutUpdate).publishedAt, "");
    default:
      return text(item[columnId], "");
  }
}

function sortRows(rows: BuildoutRow[], columnId: string | null, direction: SortDirection) {
  if (!columnId) return rows;
  return [...rows].sort((left, right) => compareStrings(
    sortValue(left, columnId),
    sortValue(right, columnId),
    direction,
  ));
}

async function buildoutApi<T>(path: string, token: string): Promise<T> {
  const response = await httpFetch(`${BUILDOUT_API_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `TheBuildout.ai request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

async function loadBuildoutData(token: string) {
  const [companiesResponse, sites, intel] = await Promise.all([
    buildoutApi<{ companies?: BuildoutCompany[] }>("/companies?limit=40&offset=0&detail=true&sort=marketCap&order=desc", token),
    buildoutApi<BuildoutSite[]>("/sites?limit=40&offset=0&detail=true&sort=activityUpdatedAt&order=desc", token),
    buildoutApi<BuildoutUpdate[]>("/updates?limit=40&offset=0", token),
  ]);

  return {
    companies: companiesResponse.companies ?? [],
    sites: Array.isArray(sites) ? sites : [],
    intel: Array.isArray(intel) ? intel : [],
  };
}

function renderCell(row: BuildoutRow, column: BuildoutColumn): DataTableCell {
  if (row.kind === "company") {
    const company = row.item;
    switch (column.id) {
      case "company":
        return { text: company.ticker ? `${company.ticker} ${company.name}` : company.name };
      case "sector":
        return { text: text(company.primarySector ?? company.primaryTechnology) };
      case "criticality":
        return { text: text(company.aiCriticality), color: colors.warning };
      case "marketCap":
        return { text: text(company.marketCap), color: colors.textDim };
      case "revenue":
        return { text: text(company.revenue), color: colors.textDim };
      case "growth":
        return { text: text(company.revenueGrowthYoy ?? company.lastQuarterGrowth), color: colors.textDim };
    }
  }

  if (row.kind === "site") {
    const site = row.item;
    const location = [site.location?.city, site.location?.country].filter(Boolean).join(", ");
    switch (column.id) {
      case "site":
        return { text: site.name };
      case "type":
        return { text: text(site.type) };
      case "owner":
        return { text: text(site.ownerTicker ?? site.ownerName) };
      case "location":
        return { text: text(location) };
      case "construction":
        return { text: activityLabel(site.constructionActivity), color: site.constructionActivity ? colors.warning : colors.textMuted };
      case "capture":
        return { text: dateShort(site.latestCapture), color: colors.textDim };
    }
  }

  const update = row.item as BuildoutUpdate;
  switch (column.id) {
    case "time":
      return { text: update.publishedAt ? formatTimeAgo(update.publishedAt).replace(" ago", "") : "-" };
    case "companies":
      return { text: text(update.companies?.map((company) => company.ticker || company.name).filter(Boolean).join(", ")) };
    case "headline":
      return { text: update.headline };
  }

  return { text: "" };
}

function DetailLine({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <Box flexDirection="row" minHeight={1}>
      <Text fg={colors.textMuted}>{label}: </Text>
      <Text fg={colors.text}>{value}</Text>
    </Box>
  );
}

function Paragraph({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <Box marginTop={1}>
      <Text fg={colors.textDim}>{children}</Text>
    </Box>
  );
}

function BuildoutDetail({ row, width, height }: { row: BuildoutRow | null; width: number; height: number }) {
  if (!row) return <EmptyState title="No row selected." />;

  const bodyWidth = Math.max(width - 2, 20);
  return (
    <ScrollBox width={width} height={height}>
      <Box flexDirection="column" paddingX={1} width={bodyWidth}>
        {row.kind === "company" && (
          <>
            <Text attributes={TextAttributes.BOLD}>{row.item.name}</Text>
            <DetailLine label="Ticker" value={row.item.ticker ?? null} />
            <DetailLine label="Sector" value={row.item.primarySector ?? row.item.primaryTechnology ?? null} />
            <DetailLine label="Criticality" value={row.item.aiCriticality ?? null} />
            <DetailLine label="Market Cap" value={row.item.marketCap ?? null} />
            <DetailLine label="Revenue" value={row.item.revenue ?? null} />
            <Paragraph>{row.item.longDescription ?? row.item.description}</Paragraph>
            {(row.item.sites?.length ?? 0) > 0 && (
              <Box marginTop={1} flexDirection="column">
                <Text fg={colors.textDim}>Sites</Text>
                {row.item.sites!.slice(0, 8).map((site, index) => (
                  <Text key={`${site.name}-${index}`} fg={colors.textMuted}>
                    {truncate(`${site.name ?? "Site"}${site.type ? ` - ${site.type}` : ""}`, bodyWidth)}
                  </Text>
                ))}
              </Box>
            )}
          </>
        )}
        {row.kind === "site" && (
          <>
            <Text attributes={TextAttributes.BOLD}>{row.item.name}</Text>
            <DetailLine label="Type" value={row.item.type ?? null} />
            <DetailLine label="Owner" value={row.item.ownerTicker ?? row.item.ownerName ?? null} />
            <DetailLine label="Location" value={[row.item.location?.city, row.item.location?.country].filter(Boolean).join(", ")} />
            <DetailLine label="Power" value={row.item.powerCapacity ?? null} />
            <DetailLine label="ETA" value={row.item.eta ?? null} />
            <DetailLine label="Latest Satellite" value={dateShort(row.item.latestCapture)} />
            <Paragraph>{row.item.description}</Paragraph>
            {(row.item.builders?.length ?? 0) > 0 && (
              <Box marginTop={1} flexDirection="column">
                <Text fg={colors.textDim}>Involved Companies</Text>
                {row.item.builders!.slice(0, 8).map((builder, index) => (
                  <Text key={`${builder.companyName}-${index}`} fg={colors.textMuted}>
                    {truncate(`${builder.companyTicker ?? builder.companyName ?? "Company"}${builder.role ? ` - ${builder.role}` : ""}`, bodyWidth)}
                  </Text>
                ))}
              </Box>
            )}
          </>
        )}
        {row.kind === "intel" && (
          <>
            <Text attributes={TextAttributes.BOLD}>{row.item.headline}</Text>
            <DetailLine label="Published" value={row.item.publishedAt ? new Date(row.item.publishedAt).toLocaleString() : null} />
            <DetailLine label="Type" value={row.item.type ?? null} />
            <DetailLine label="Status" value={row.item.verificationStatus ?? null} />
            <DetailLine label="Companies" value={row.item.companies?.map((company) => company.ticker || company.name).filter(Boolean).join(", ")} />
            <Paragraph>{row.item.context ?? row.item.content}</Paragraph>
          </>
        )}
      </Box>
    </ScrollBox>
  );
}

export function BuildoutPane({ focused, width, height }: PaneProps) {
  const [state, setState] = useState<BuildoutLoadState>({ status: "loading" });
  const [activeTab, setActiveTab] = useState<BuildoutTabId>("companies");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailRow, setDetailRow] = useState<BuildoutRow | null>(null);
  const [sortColumnId, setSortColumnId] = useState<string | null>("company");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [refreshVersion, setRefreshVersion] = useState(0);

  const refresh = useCallback(() => {
    setRefreshVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState({ status: "loading" });
      setDetailRow(null);

      if (!apiClient.getSessionToken()) {
        if (!cancelled) setState({ status: "auth" });
        return;
      }

      const session = await apiClient.getSession().catch(() => null);
      if (!session) {
        if (!cancelled) setState({ status: "auth" });
        return;
      }

      const account = await apiClient.getBuildoutAccount();
      if (!account.subscription.active) {
        if (!cancelled) setState({ status: "inactive" });
        return;
      }

      const token = await apiClient.getBuildoutToken();
      const data = await loadBuildoutData(token.token);
      if (!cancelled) {
        setState({
          status: "ready",
          ...data,
          loadedAt: Date.now(),
        });
      }
    }

    load().catch((error) => {
      if (!cancelled) {
        setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [refreshVersion]);

  useEffect(() => {
    setSelectedIndex(0);
    setDetailRow(null);
    setSortColumnId(activeTab === "companies" ? "company" : activeTab === "sites" ? "site" : "time");
    setSortDirection(activeTab === "intel" ? "desc" : "asc");
  }, [activeTab]);

  const rows = useMemo(() => sortRows(activeRows(state, activeTab), sortColumnId, sortDirection), [activeTab, sortColumnId, sortDirection, state]);
  const columns = useMemo(() => columnsForTab(activeTab), [activeTab]);
  const selectedRow = rows[selectedIndex] ?? rows[0] ?? null;

  usePaneFooter("buildout", () => ({
    info: [
      {
        id: "state",
        parts: [
          { text: "TBO", tone: "label" },
          { text: state.status === "ready" ? `${rows.length} ${activeTab}` : state.status, tone: state.status === "inactive" ? "warning" : "value" },
        ],
      },
    ],
    hints: [
      { id: "refresh", key: "r", label: "refresh", onPress: refresh },
      ...(detailRow ? [{ id: "back", key: "esc", label: "back", onPress: () => setDetailRow(null) }] : []),
    ],
  }), [activeTab, detailRow, refresh, rows.length, state.status]);

  const handleHeaderClick = useCallback((columnId: string) => {
    setSortColumnId((current) => {
      if (current === columnId) {
        setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
        return current;
      }
      setSortDirection("asc");
      return columnId;
    });
  }, []);

  const handleRootKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name !== "r") return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    refresh();
    return true;
  }, [refresh]);

  if (state.status === "loading") {
    return <Box padding={1}><Spinner label="Loading TheBuildout.ai..." /></Box>;
  }

  if (state.status === "auth") {
    return (
      <Box flexDirection="column" padding={1} gap={1}>
        <Text fg={colors.textDim}>Log in with your Gloom account to open TBO.</Text>
        <InlineAuthActions />
      </Box>
    );
  }

  if (state.status === "inactive") {
    return <Box padding={1}><EmptyState title="Requires TheBuildout.ai subscription." /></Box>;
  }

  if (state.status === "error") {
    return (
      <Box padding={1}>
        <EmptyState title="Could not load TheBuildout.ai." message={state.message} hint="Press r to retry." />
      </Box>
    );
  }

  return (
    <DataTableStackView<BuildoutRow, BuildoutColumn>
      focused={focused}
      detailOpen={!!detailRow}
      onBack={() => setDetailRow(null)}
      detailTitle={detailRow ? rowKey(detailRow) : undefined}
      detailContent={<BuildoutDetail row={detailRow} width={width} height={height} />}
      rootWidth={width}
      rootHeight={height}
      rootBefore={(
        <Box height={1}>
          <Tabs
            tabs={tabs}
            activeValue={activeTab}
            onSelect={(value) => setActiveTab(value as BuildoutTabId)}
            compact
            variant="bare"
            focused={focused && !detailRow}
          />
        </Box>
      )}
      columns={columns}
      items={rows}
      selectedIndex={selectedIndex}
      onSelectIndex={(index) => setSelectedIndex(index)}
      onActivateIndex={(_index, row) => setDetailRow(row)}
      sortColumnId={sortColumnId}
      sortDirection={sortDirection}
      onHeaderClick={handleHeaderClick}
      getItemKey={rowKey}
      isSelected={(row) => selectedRow ? rowKey(row) === rowKey(selectedRow) : false}
      onSelect={(row, index) => setSelectedIndex(index)}
      onActivate={(row) => setDetailRow(row)}
      renderCell={renderCell}
      emptyStateTitle="No Buildout rows"
      emptyStateHint="Press r to refresh."
      onRootKeyDown={handleRootKeyDown}
      resetScrollKey={activeTab}
    />
  );
}
