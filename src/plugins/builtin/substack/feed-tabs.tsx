import { memo, useMemo } from "react";
import { Box } from "../../../ui";
import { Tabs } from "../../../components";
import { tabIdForPublication } from "./table";
import {
  SUBSTACK_FEED_TAB_ID,
  type SubstackPublication,
} from "./types";
import { tabLabel } from "./pane-state";

export const SubstackFeedTabs = memo(function SubstackFeedTabs({
  subscriptions,
  activeTab,
  focused,
  detailOpen,
  onSelect,
}: {
  subscriptions: SubstackPublication[];
  activeTab: string;
  focused: boolean;
  detailOpen: boolean;
  onSelect: (tabId: string) => void;
}) {
  const tabs = useMemo(() => [
    { label: "Feed", value: SUBSTACK_FEED_TAB_ID },
    ...subscriptions.map((publication) => ({
      label: tabLabel(publication.name),
      value: tabIdForPublication(publication),
    })),
  ], [subscriptions]);

  return (
    <Box height={1}>
      <Tabs
        tabs={tabs}
        activeValue={activeTab}
        onSelect={onSelect}
        compact
        variant="pill"
        focused={focused && !detailOpen}
      />
    </Box>
  );
});
