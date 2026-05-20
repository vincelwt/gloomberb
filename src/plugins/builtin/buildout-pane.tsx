import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, TextAttributes, type ScrollBoxRenderable, useRendererHost } from "../../ui";
import {
  DataTableStackView,
  EmptyState,
  Spinner,
  Tabs,
  usePaneFooter,
  type DataTableCell,
  type DataTableKeyEvent,
  type PaneFooterSegment,
  type PaneHint,
} from "../../components";
import type { PaneProps } from "../../types/plugin";
import { colors } from "../../theme/colors";
import { useShortcut } from "../../react/input";
import { useInlineTickers } from "../../state/use-inline-tickers";
import {
  BuildoutDetail,
  CompaniesUpgradeCta,
  CompanyCell,
  FavoriteCell,
  tickerBadges,
} from "./buildout/detail";
import type {
  BuildoutColumn,
  BuildoutColumnId,
  BuildoutCompany,
  BuildoutList,
  BuildoutLoadState,
  BuildoutRow,
  BuildoutTabId,
  SortDirection,
} from "./buildout/model";
import {
  BUILDOUT_NAME,
  LOAD_MORE_THRESHOLD,
  PAGE_SIZE,
  activeRows,
  activityColor,
  activityLabel,
  appendUniqueById,
  applyFavoriteToState,
  buildoutApi,
  columnsForTab,
  criticalityColor,
  defaultSortDirection,
  emptyPage,
  favoriteApiPath,
  favoriteKey,
  fetchCompaniesPage,
  fetchIntelPage,
  fetchSitesPage,
  formatRelativeTime,
  getBuildoutProToken,
  loadBuildoutData,
  metricColor,
  rowKey,
  rowStarred,
  rowTickerSymbols,
  rowTitle,
  rowWithFavorite,
  sortRows,
  tabs,
  text,
  tickerSearchText,
  tickerSymbol,
  truncate,
} from "./buildout/model";

const BUILDOUT_UPGRADE_URL = "https://thebuildout.ai/pricing";

function activePage(state: BuildoutLoadState, activeTab: BuildoutTabId, selectedList: BuildoutList | null) {
  if (state.status !== "ready") return null;
  if (activeTab === "companies") return selectedList ? state.companies : null;
  if (activeTab === "sites") return state.sites;
  return state.intel;
}

function updateFooterInfo(
  state: BuildoutLoadState,
  activeTab: BuildoutTabId,
  selectedList: BuildoutList | null,
  favoriteMessage: string | null,
): PaneFooterSegment[] {
  if (state.status === "loading") {
    return [{ id: "loading", parts: [{ text: "loading", tone: "value" }] }];
  }

  if (state.status === "error") {
    return [{ id: "error", parts: [{ text: "load failed", tone: "negative" }] }];
  }

  const info: PaneFooterSegment[] = [{
    id: "access",
    parts: [{
      text: state.access === "pro"
        ? "pro access"
        : activeTab === "intel" ? "delayed 72h" : "upgrade for full data",
      tone: state.access === "pro" ? "positive" : "warning",
    }],
  }];

  const page = activePage(state, activeTab, selectedList);
  if (page?.loadingMore) {
    info.push({ id: "loading-more", parts: [{ text: "loading more", tone: "value" }] });
  }
  if (page?.error) {
    info.push({ id: "page-error", parts: [{ text: page.error, tone: "negative" }] });
  }
  if (favoriteMessage) {
    info.push({ id: "favorite-error", parts: [{ text: favoriteMessage, tone: "negative" }] });
  }

  return info;
}

function pageStatusContent(
  state: BuildoutLoadState,
  activeTab: BuildoutTabId,
  selectedList: BuildoutList | null,
) {
  const page = activePage(state, activeTab, selectedList);
  if (!page) return null;
  if (page.loadingMore && page.items.length === 0) {
    return (
      <Box width="100%" paddingX={1} paddingY={1}>
        <Spinner label={`Loading ${selectedList?.name ?? activeTab}...`} />
      </Box>
    );
  }
  if (page.error) {
    return (
      <Box width="100%" paddingX={1} paddingY={1}>
        <EmptyState title="Could not load rows." message={page.error} />
      </Box>
    );
  }
  return null;
}

export function BuildoutPane({ focused, width, height }: PaneProps) {
  const rendererHost = useRendererHost();
  const tableScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const loadingPageKeysRef = useRef<Set<string>>(new Set());
  const favoriteBusyKeysRef = useRef<Set<string>>(new Set());
  const [state, setState] = useState<BuildoutLoadState>({ status: "loading" });
  const [activeTab, setActiveTab] = useState<BuildoutTabId>("companies");
  const [selectedList, setSelectedList] = useState<BuildoutList | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailRow, setDetailRow] = useState<BuildoutRow | null>(null);
  const [sortColumnId, setSortColumnId] = useState<BuildoutColumnId | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [upgradeBusy, setUpgradeBusy] = useState(false);
  const [upgradeMessage, setUpgradeMessage] = useState<string | null>(null);
  const [favoriteBusyKey, setFavoriteBusyKey] = useState<string | null>(null);
  const [favoriteMessage, setFavoriteMessage] = useState<string | null>(null);
  const favoriteToken = state.status === "ready" ? state.token : null;
  const canFavorite = favoriteToken != null;

  const refresh = useCallback(() => {
    setRefreshVersion((version) => version + 1);
  }, []);

  const startUpgrade = useCallback(() => {
    if (upgradeBusy) return;
    setUpgradeBusy(true);
    setUpgradeMessage(null);
    void rendererHost.openExternal(BUILDOUT_UPGRADE_URL)
      .catch((error) => {
        setUpgradeMessage(error instanceof Error ? error.message : "upgrade page failed");
      })
      .finally(() => {
        setUpgradeBusy(false);
      });
  }, [rendererHost, upgradeBusy]);

  useShortcut((event) => {
    const key = (event.name ?? event.key ?? "").toLowerCase();
    if (!focused || key !== "u" || state.status !== "ready" || state.access === "pro") return;
    event.preventDefault();
    event.stopPropagation();
    startUpgrade();
  }, { scope: "buildout-upgrade" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      loadingPageKeysRef.current.clear();
      favoriteBusyKeysRef.current.clear();
      setState({ status: "loading" });
      setDetailRow(null);
      setSelectedList(null);
      setUpgradeMessage(null);
      setFavoriteMessage(null);
      setFavoriteBusyKey(null);

      const token = await getBuildoutProToken();
      const data = await loadBuildoutData(token);
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
    setFavoriteMessage(null);
    const nextColumn: BuildoutColumnId | null = activeTab === "companies"
      ? selectedList ? "marketCap" : null
      : activeTab === "sites" ? "capture" : "time";
    setSortColumnId(nextColumn);
    setSortDirection(defaultSortDirection(nextColumn));
  }, [activeTab, selectedList?.slug]);

  const loadCompanies = useCallback(async (list: BuildoutList, offset: number, append: boolean) => {
    const pageKey = `companies:${list.slug}:${offset}`;
    if (loadingPageKeysRef.current.has(pageKey)) return;
    loadingPageKeysRef.current.add(pageKey);
    const token = state.status === "ready" ? state.token : null;
    setState((current) => {
      if (current.status !== "ready") return current;
      return {
        ...current,
        companies: {
          ...(append ? current.companies : { ...emptyPage<BuildoutCompany>(), blurredCompanyCount: 0 }),
          loadingMore: true,
          error: null,
        },
      };
    });

    try {
      const page = await fetchCompaniesPage(token, list.slug, offset);
      setState((current) => {
        if (current.status !== "ready") return current;
        const previousItems = append ? current.companies.items : [];
        const items = appendUniqueById(previousItems, page.items);
        return {
          ...current,
          companies: {
            items,
            offset: items.length,
            hasMore: page.items.length >= PAGE_SIZE,
            loadingMore: false,
            error: null,
            blurredCompanyCount: append
              ? Math.max(current.companies.blurredCompanyCount, page.blurredCompanyCount)
              : page.blurredCompanyCount,
          },
        };
      });
    } catch (error) {
      setState((current) => {
        if (current.status !== "ready") return current;
        return {
          ...current,
          companies: {
            ...current.companies,
            loadingMore: false,
            error: error instanceof Error ? error.message : String(error),
          },
        };
      });
    } finally {
      loadingPageKeysRef.current.delete(pageKey);
    }
  }, [state]);

  const loadSites = useCallback(async (offset: number, append: boolean) => {
    const pageKey = `sites:${offset}`;
    if (loadingPageKeysRef.current.has(pageKey)) return;
    loadingPageKeysRef.current.add(pageKey);
    const token = state.status === "ready" ? state.token : null;
    setState((current) => current.status === "ready"
      ? { ...current, sites: { ...current.sites, loadingMore: true, error: null } }
      : current);

    try {
      const page = await fetchSitesPage(token, offset);
      setState((current) => {
        if (current.status !== "ready") return current;
        const previousItems = append ? current.sites.items : [];
        const items = appendUniqueById(previousItems, page);
        return {
          ...current,
          sites: {
            items,
            offset: items.length,
            hasMore: page.length >= PAGE_SIZE,
            loadingMore: false,
            error: null,
          },
        };
      });
    } catch (error) {
      setState((current) => current.status === "ready"
        ? {
          ...current,
          sites: {
            ...current.sites,
            loadingMore: false,
            error: error instanceof Error ? error.message : String(error),
          },
        }
        : current);
    } finally {
      loadingPageKeysRef.current.delete(pageKey);
    }
  }, [state]);

  const loadIntel = useCallback(async (offset: number, append: boolean) => {
    const pageKey = `intel:${offset}`;
    if (loadingPageKeysRef.current.has(pageKey)) return;
    loadingPageKeysRef.current.add(pageKey);
    const token = state.status === "ready" ? state.token : null;
    setState((current) => current.status === "ready"
      ? { ...current, intel: { ...current.intel, loadingMore: true, error: null } }
      : current);

    try {
      const page = await fetchIntelPage(token, offset);
      setState((current) => {
        if (current.status !== "ready") return current;
        const previousItems = append ? current.intel.items : [];
        const items = appendUniqueById(previousItems, page);
        return {
          ...current,
          intel: {
            items,
            offset: items.length,
            hasMore: page.length >= PAGE_SIZE,
            loadingMore: false,
            error: null,
          },
        };
      });
    } catch (error) {
      setState((current) => current.status === "ready"
        ? {
          ...current,
          intel: {
            ...current.intel,
            loadingMore: false,
            error: error instanceof Error ? error.message : String(error),
          },
        }
        : current);
    } finally {
      loadingPageKeysRef.current.delete(pageKey);
    }
  }, [state]);

  useEffect(() => {
    if (state.status !== "ready" || activeTab !== "companies" || !selectedList) return;
    if (state.companies.items.length > 0 || state.companies.loadingMore || state.companies.error) return;
    void loadCompanies(selectedList, 0, false);
  }, [activeTab, loadCompanies, selectedList, state]);

  const rows = useMemo(
    () => sortRows(activeRows(state, activeTab, selectedList), sortColumnId, sortDirection),
    [activeTab, selectedList, sortColumnId, sortDirection, state],
  );
  const columns = useMemo(() => columnsForTab(activeTab, selectedList, canFavorite), [activeTab, canFavorite, selectedList]);
  const selectedRow = rows[selectedIndex] ?? rows[0] ?? null;
  const tickerTexts = useMemo(() => {
    const symbols = new Set<string>();
    for (const row of rows) {
      for (const symbol of rowTickerSymbols(row)) symbols.add(symbol);
    }
    if (detailRow) {
      for (const symbol of rowTickerSymbols(detailRow)) symbols.add(symbol);
    }
    return [tickerSearchText([...symbols])];
  }, [detailRow, rows]);
  const { catalog: tickerCatalog, openTicker } = useInlineTickers(tickerTexts);
  const detailCompanyTicker = detailRow?.kind === "company" ? tickerSymbol(detailRow.item.ticker) : null;
  const openDetailTicker = useCallback(() => {
    if (!detailCompanyTicker) return;
    openTicker(detailCompanyTicker);
  }, [detailCompanyTicker, openTicker]);
  const footerHints = useMemo<PaneHint[]>(() => {
    const hints: PaneHint[] = [];
    if (state.status === "ready" && state.access !== "pro") {
      hints.push({ id: "upgrade", key: "u", label: "pgrade", onPress: startUpgrade });
    }
    if (detailCompanyTicker) {
      hints.push({ id: "open-ticker", key: "o", label: "pen", onPress: openDetailTicker });
    }
    return hints;
  }, [detailCompanyTicker, openDetailTicker, startUpgrade, state]);

  usePaneFooter("buildout", () => ({
    info: updateFooterInfo(state, activeTab, selectedList, favoriteMessage),
    hints: footerHints,
  }), [activeTab, favoriteMessage, footerHints, selectedList, state]);

  const handleHeaderClick = useCallback((columnId: string) => {
    const nextColumnId = columnId as BuildoutColumnId;
    setSortColumnId((current) => {
      if (current === nextColumnId) {
        setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
        return current;
      }
      setSortDirection(defaultSortDirection(nextColumnId));
      return nextColumnId;
    });
  }, []);

  const openCompanyList = useCallback((list: BuildoutList) => {
    setSelectedList(list);
    setSelectedIndex(0);
    setDetailRow(null);
    setUpgradeMessage(null);
    setFavoriteMessage(null);
    setSortColumnId("marketCap");
    setSortDirection("desc");
    setState((current) => current.status === "ready"
      ? {
        ...current,
        companies: { ...emptyPage<BuildoutCompany>(), blurredCompanyCount: 0 },
      }
      : current);
  }, []);

  const closeCompanyList = useCallback(() => {
    setSelectedList(null);
    setSelectedIndex(0);
    setDetailRow(null);
    setUpgradeMessage(null);
    setFavoriteMessage(null);
    setSortColumnId(null);
    setSortDirection("asc");
  }, []);

  const activateRow = useCallback((row: BuildoutRow) => {
    if (row.kind === "list") {
      openCompanyList(row.item);
      return;
    }
    setDetailRow(row);
  }, [openCompanyList]);

  const updateFavorite = useCallback((key: string, starred: boolean) => {
    setState((current) => applyFavoriteToState(current, key, starred));
    setDetailRow((current) => (
      current && favoriteKey(current) === key ? rowWithFavorite(current, starred) : current
    ));
  }, []);

  const toggleFavorite = useCallback(async (row: BuildoutRow) => {
    if (!favoriteToken) return;
    const key = favoriteKey(row);
    const path = favoriteApiPath(row);
    if (!key || !path || favoriteBusyKeysRef.current.has(key)) return;

    const previous = rowStarred(row);
    const next = !previous;
    favoriteBusyKeysRef.current.add(key);
    setFavoriteBusyKey(key);
    setFavoriteMessage(null);
    updateFavorite(key, next);

    try {
      const response = await buildoutApi<{ starred?: boolean }>(path, favoriteToken, { method: "POST" });
      updateFavorite(key, typeof response.starred === "boolean" ? response.starred : next);
    } catch {
      updateFavorite(key, previous);
      setFavoriteMessage("favorite failed");
    } finally {
      favoriteBusyKeysRef.current.delete(key);
      setFavoriteBusyKey((current) => current === key ? null : current);
    }
  }, [favoriteToken, updateFavorite]);

  const toggleFavoriteRow = useCallback((row: BuildoutRow | null) => {
    if (!canFavorite || !row || !favoriteKey(row)) return false;
    void toggleFavorite(row);
    return true;
  }, [canFavorite, toggleFavorite]);

  const loadMoreActiveRows = useCallback(() => {
    if (state.status !== "ready") return;
    const scrollBox = tableScrollRef.current;
    if (!scrollBox?.viewport) return;
    const page = activePage(state, activeTab, selectedList);
    if (!page || page.loadingMore || !page.hasMore || page.error) return;
    const visibleBottom = scrollBox.scrollTop + scrollBox.viewport.height;
    const remaining = page.items.length - visibleBottom;
    if (remaining > LOAD_MORE_THRESHOLD) return;

    if (activeTab === "companies" && selectedList) {
      void loadCompanies(selectedList, page.offset, true);
    } else if (activeTab === "sites") {
      void loadSites(page.offset, true);
    } else if (activeTab === "intel") {
      void loadIntel(page.offset, true);
    }
  }, [activeTab, loadCompanies, loadIntel, loadSites, selectedList, state]);

  const handleRootKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name === "u" && state.status === "ready" && state.access !== "pro") {
      event.preventDefault?.();
      event.stopPropagation?.();
      void startUpgrade();
      return true;
    }
    if ((event.name === "s" || event.name === "f") && toggleFavoriteRow(selectedRow)) {
      event.preventDefault?.();
      event.stopPropagation?.();
      return true;
    }
    if (event.name === "r") {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
      return true;
    }
    if (activeTab === "companies" && selectedList && (event.name === "escape" || event.name === "backspace")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      closeCompanyList();
      return true;
    }
    return false;
  }, [activeTab, closeCompanyList, refresh, selectedList, selectedRow, startUpgrade, state, toggleFavoriteRow]);

  const handleDetailKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (event.name === "u" && state.status === "ready" && state.access !== "pro") {
      event.preventDefault?.();
      event.stopPropagation?.();
      void startUpgrade();
      return true;
    }
    if ((event.name === "s" || event.name === "f") && toggleFavoriteRow(detailRow)) {
      event.preventDefault?.();
      event.stopPropagation?.();
      return true;
    }
    if (event.name !== "o" || !detailCompanyTicker) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    openDetailTicker();
    return true;
  }, [detailCompanyTicker, detailRow, openDetailTicker, startUpgrade, state, toggleFavoriteRow]);

  const renderCell = useCallback((
    row: BuildoutRow,
    column: BuildoutColumn,
    _index: number,
    rowState: { selected: boolean; hovered: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;

    if (row.kind === "list") {
      const list = row.item;
      switch (column.id) {
        case "listName":
          return { text: list.name, color: selectedColor ?? colors.text };
        case "listDescription":
          return { text: text(list.shortDescription ?? list.description), color: selectedColor ?? colors.textDim };
        case "companyCount":
          return { text: list.companyCount == null ? "-" : String(list.companyCount), color: selectedColor ?? colors.textDim };
        case "totalMarketCap":
          return { text: text(list.totalMarketCap), color: selectedColor ?? colors.textDim };
        case "avgSectorGrowth":
          return { text: text(list.avgSectorGrowth), color: selectedColor ?? metricColor(list.avgSectorGrowth) };
        case "avgReturn1y":
          return { text: text(list.avgReturn1y), color: selectedColor ?? metricColor(list.avgReturn1y) };
        case "avgMargin":
          return { text: text(list.avgMargin), color: selectedColor ?? metricColor(list.avgMargin) };
      }
    }

    if (row.kind === "company") {
      const company = row.item;
      switch (column.id) {
        case "favorite": {
          const key = favoriteKey(row);
          const busy = key != null && favoriteBusyKey === key;
          return {
            text: company.starred ? "★" : "☆",
            content: (
              <FavoriteCell
                starred={company.starred === true}
                busy={busy}
                selected={rowState.selected}
                interactive
              />
            ),
            onMouseDown: (event) => {
              event.preventDefault?.();
              event.stopPropagation?.();
              void toggleFavorite(row);
            },
          };
        }
        case "company":
          return {
            text: company.ticker ? `${company.ticker} ${company.name}` : company.name,
            content: (
              <CompanyCell
                company={company}
                width={column.width}
                selected={rowState.selected}
                catalog={tickerCatalog}
                openTicker={openTicker}
              />
            ),
          };
        case "description":
          return { text: text(company.description), color: selectedColor ?? colors.textDim };
        case "sectorTech":
          return { text: text([company.primarySector, company.primaryTechnology].filter(Boolean).join(" / ")), color: selectedColor ?? colors.textDim };
        case "criticality":
          return { text: text(company.aiCriticality), color: criticalityColor(company.aiCriticality, rowState.selected), attributes: TextAttributes.BOLD };
        case "marketCap":
          return { text: text(company.marketCap), color: selectedColor ?? colors.textDim };
        case "revenue":
          return { text: text(company.revenue), color: selectedColor ?? colors.textDim };
        case "revenueGrowth":
          return {
            text: text(company.revenueGrowthYoy ?? company.lastQuarterGrowth),
            color: selectedColor ?? metricColor(company.revenueGrowthYoy ?? company.lastQuarterGrowth),
          };
        case "netIncome":
          return { text: text(company.netIncome), color: selectedColor ?? metricColor(company.netIncome) };
        case "margin":
          return { text: text(company.profitMargins), color: selectedColor ?? metricColor(company.profitMargins) };
        case "forwardPE":
          return { text: text(company.forwardPE), color: selectedColor ?? colors.textDim };
        case "dividendYield":
          return { text: text(company.dividendYield), color: selectedColor ?? metricColor(company.dividendYield) };
        case "return1y":
          return { text: text(company.return1y), color: selectedColor ?? metricColor(company.return1y) };
        case "employees":
          return { text: text(company.employeeCount), color: selectedColor ?? colors.textDim };
      }
    }

    if (row.kind === "site") {
      const site = row.item;
      const location = [site.location?.city, site.location?.country].filter(Boolean).join(", ");
      switch (column.id) {
        case "favorite": {
          const key = favoriteKey(row);
          const busy = key != null && favoriteBusyKey === key;
          return {
            text: site.starred ? "★" : "☆",
            content: (
              <FavoriteCell
                starred={site.starred === true}
                busy={busy}
                selected={rowState.selected}
                interactive
              />
            ),
            onMouseDown: (event) => {
              event.preventDefault?.();
              event.stopPropagation?.();
              void toggleFavorite(row);
            },
          };
        }
        case "site":
          return { text: site.name, color: selectedColor ?? colors.text };
        case "type":
          return { text: text(site.type), color: selectedColor ?? colors.textDim };
        case "owner": {
          const ownerTicker = tickerSymbol(site.ownerTicker);
          if (ownerTicker) {
            return {
              text: ownerTicker,
              content: tickerBadges({
                symbols: [ownerTicker],
                width: column.width,
                catalog: tickerCatalog,
                openTicker,
                fallbackColor: selectedColor ?? colors.textBright,
              }),
            };
          }
          return { text: text(site.ownerName), color: selectedColor ?? colors.textDim };
        }
        case "location":
          return { text: text(location), color: selectedColor ?? colors.textDim };
        case "park":
          return { text: text(site.parkName), color: selectedColor ?? colors.textDim };
        case "power":
          return { text: text(site.powerCapacity), color: selectedColor ?? colors.textDim };
        case "construction":
          return { text: activityLabel(site.constructionActivity), color: activityColor(site.constructionActivity, rowState.selected) };
        case "parking":
          return { text: activityLabel(site.parkingActivity), color: activityColor(site.parkingActivity, rowState.selected) };
        case "capture":
          return { text: formatRelativeTime(site.latestCapture), color: selectedColor ?? colors.textDim };
        case "area":
          return { text: text(site.areaKm2), color: selectedColor ?? colors.textDim };
      }
    }

    if (row.kind === "intel") {
      const update = row.item;
      switch (column.id) {
        case "time":
          return { text: formatRelativeTime(update.publishedAt), color: selectedColor ?? colors.textDim };
        case "companies": {
          const symbols = (update.companies ?? [])
            .map((company) => tickerSymbol(company.ticker))
            .filter((symbol): symbol is string => symbol != null);
          return symbols.length > 0
            ? {
              text: symbols.join(" "),
              content: tickerBadges({
                symbols,
                width: column.width,
                catalog: tickerCatalog,
                openTicker,
                fallbackColor: selectedColor ?? colors.textBright,
              }),
            }
            : { text: text(update.companies?.map((company) => company.name).filter(Boolean).join(", ")), color: selectedColor ?? colors.textDim };
        }
        case "headline":
          return { text: update.headline, color: selectedColor ?? colors.text };
      }
    }

    return { text: "" };
  }, [favoriteBusyKey, openTicker, tickerCatalog, toggleFavorite]);

  if (state.status === "loading") {
    return <Box padding={1}><Spinner label={`Loading ${BUILDOUT_NAME}...`} /></Box>;
  }

  if (state.status === "error") {
    return (
      <Box padding={1}>
        <EmptyState title={`Could not load ${BUILDOUT_NAME}.`} message={state.message} />
      </Box>
    );
  }

  const beforeHeight = selectedList && activeTab === "companies" ? 2 : 1;
  const hiddenCompanyCount = state.status === "ready"
    && activeTab === "companies"
    && selectedList
    && !state.companies.loadingMore
    && !state.companies.hasMore
    && !state.companies.error
    ? state.companies.blurredCompanyCount
    : 0;

  return (
    <DataTableStackView<BuildoutRow, BuildoutColumn>
      focused={focused}
      detailOpen={!!detailRow}
      onBack={() => setDetailRow(null)}
      detailTitle={detailRow ? rowTitle(detailRow) : undefined}
      detailContent={(
        <BuildoutDetail
          row={detailRow}
          width={width}
          height={height}
          catalog={tickerCatalog}
          openTicker={openTicker}
          canFavorite={canFavorite}
          favoriteBusyKey={favoriteBusyKey}
          onToggleFavorite={toggleFavorite}
        />
      )}
      rootWidth={width}
      rootHeight={height}
      rootBefore={(
        <Box flexDirection="column" height={beforeHeight}>
          <Tabs
            tabs={tabs}
            activeValue={activeTab}
            onSelect={(value) => setActiveTab(value as BuildoutTabId)}
            compact
            variant="bare"
            focused={focused && !detailRow}
          />
          {selectedList && activeTab === "companies" ? (
            <Box height={1} flexDirection="row" paddingX={1}>
              <Box
                onMouseDown={(event: any) => {
                  event.preventDefault();
                  closeCompanyList();
                }}
              >
                <Text fg={colors.borderFocused} attributes={TextAttributes.BOLD}>{"< Lists"}</Text>
              </Box>
              <Text fg={colors.textMuted}>  /  </Text>
              <Text fg={colors.text}>{truncate(selectedList.name, Math.max(0, width - 14))}</Text>
            </Box>
          ) : null}
        </Box>
      )}
      columns={columns}
      items={rows}
      selectedIndex={selectedIndex}
      onSelectIndex={(index) => setSelectedIndex(index)}
      onActivateIndex={(_index, row) => activateRow(row)}
      sortColumnId={sortColumnId}
      sortDirection={sortDirection}
      onHeaderClick={handleHeaderClick}
      getItemKey={rowKey}
      isSelected={(row) => selectedRow ? rowKey(row) === rowKey(selectedRow) : false}
      onSelect={(_row, index) => setSelectedIndex(index)}
      onActivate={activateRow}
      renderCell={renderCell}
      bodyAfter={hiddenCompanyCount > 0 ? (
        <CompaniesUpgradeCta
          hiddenCount={hiddenCompanyCount}
          width={width}
          busy={upgradeBusy}
          message={upgradeMessage}
          onUpgrade={startUpgrade}
        />
      ) : null}
      emptyContent={pageStatusContent(state, activeTab, selectedList)}
      emptyStateTitle={selectedList ? "No companies" : "No rows"}
      onRootKeyDown={handleRootKeyDown}
      onDetailKeyDown={handleDetailKeyDown}
      onBodyScrollActivity={loadMoreActiveRows}
      scrollRef={tableScrollRef}
      resetScrollKey={`${activeTab}:${selectedList?.slug ?? "lists"}`}
    />
  );
}
