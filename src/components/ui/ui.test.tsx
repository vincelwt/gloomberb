import { afterEach, describe, expect, test } from "bun:test";
import { act, useRef, useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import type { ScrollBoxRenderable } from "@opentui/core";
import { Button } from "./button";
import { DataTable } from "./data-table";
import { TextField } from "./fields";
import { ListView } from "./list-view";
import { ProgressBar } from "./loading";
import { Notice } from "./status";
import { Tabs } from "./tabs";
import { ToggleList } from "../toggle-list";
import { AppContext, PaneInstanceProvider, createInitialState } from "../../state/app-context";
import { createDefaultConfig } from "../../types/config";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
let setListSelection: ((index: number) => void) | null = null;
let selectedTableRow: string | null = null;
let activatedTableRow: string | null = null;

function ScrollableListHarness() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  setListSelection = setSelectedIndex;

  return (
    <ListView
      items={Array.from({ length: 12 }, (_, index) => ({
        id: `row-${index}`,
        label: `Row ${index + 1}`,
      }))}
      selectedIndex={selectedIndex}
      height={4}
      scrollable
    />
  );
}

function DataTableActivationHarness() {
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <DataTable
      columns={[{ id: "name", label: "NAME", width: 12, align: "left" }]}
      items={[{ id: "alpha", name: "Alpha" }]}
      sortColumnId={null}
      sortDirection="asc"
      onHeaderClick={() => {}}
      headerScrollRef={headerScrollRef}
      scrollRef={scrollRef}
      syncHeaderScroll={() => {}}
      onBodyScrollActivity={() => {}}
      hoveredIdx={hoveredIdx}
      setHoveredIdx={setHoveredIdx}
      getItemKey={(row) => row.id}
      isSelected={(row) => selectedId === row.id}
      onSelect={(row) => {
        selectedTableRow = row.id;
        setSelectedId(row.id);
      }}
      onActivate={(row) => {
        activatedTableRow = row.id;
      }}
      renderCell={(row) => ({ text: row.name })}
      emptyStateTitle="No rows."
    />
  );
}

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
    testSetup = undefined;
  }
  setListSelection = null;
  selectedTableRow = null;
  activatedTableRow = null;
});

describe("shared UI kit", () => {
  test("renders navigation and feedback primitives", async () => {
    testSetup = await testRender(
      <box flexDirection="column">
        <Tabs
          tabs={[
            { label: "Overview", value: "overview" },
            { label: "News", value: "news" },
          ]}
          activeValue="overview"
          onSelect={() => {}}
        />
        <box height={1} />
        <Button label="Save" variant="primary" shortcut="⌘S" onPress={() => {}} />
        <box height={1} />
        <ProgressBar value={0.5} width={8} label="Syncing" />
        <box height={1} />
        <Notice title="Connected" message="Broker session is live" tone="success" />
      </box>,
      { width: 40, height: 10 },
    );

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Overview");
    expect(frame).toContain("Save");
    expect(frame).toContain("Syncing");
    expect(frame).toContain("Connected");
  });

  test("renders toggle lists with selection and descriptions", async () => {
    testSetup = await testRender(
      <ToggleList
        items={[
          { id: "news", label: "News", enabled: true, description: "Headlines and previews" },
          { id: "notes", label: "Notes", enabled: false, description: "Ticker notes" },
        ]}
        selectedIdx={0}
        onSelect={() => {}}
        onToggle={() => {}}
      />,
      { width: 40, height: 6 },
    );

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("[✓] News");
    expect(frame).toContain("Notes");
    expect(frame).toContain("Headlines and previews");
  });

  test("auto-scrolls a scrollable list to keep the selected row visible", async () => {
    testSetup = await testRender(
      <ScrollableListHarness />,
      { width: 20, height: 6 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
    });
    await act(async () => {
      setListSelection!(8);
      await Promise.resolve();
    });
    await act(async () => {
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Row 9");
    expect(frame).not.toContain("Row 1");
  });

  test("masks password text fields", async () => {
    testSetup = await testRender(
      <TextField
        type="password"
        value="secret"
        placeholder="Password"
        focused
        width={12}
        onChange={() => {}}
      />,
      { width: 16, height: 3 },
    );

    await testSetup.renderOnce();

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("******");
    expect(frame).not.toContain("secret");
  });

  test("does not allow selecting masked password fields", async () => {
    testSetup = await testRender(
      <TextField
        type="password"
        value="secret"
        focused
        width={12}
        onChange={() => {}}
      />,
      { width: 16, height: 3 },
    );

    await testSetup.renderOnce();

    await act(async () => {
      await testSetup!.mockMouse.drag(1, 0, 6, 0);
      await testSetup!.renderOnce();
    });

    expect(testSetup.renderer.getSelection()).toBeNull();
  });

  test("activates data table rows on a second click", async () => {
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-test"));
    testSetup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        <PaneInstanceProvider paneId="portfolio-list:main">
          <DataTableActivationHarness />
        </PaneInstanceProvider>
      </AppContext>,
      { width: 32, height: 5 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
    });
    await act(async () => {
      await testSetup!.mockMouse.click(2, 1);
      await testSetup!.renderOnce();
    });

    expect(selectedTableRow).toBe("alpha");
    expect(activatedTableRow).toBeNull();

    await act(async () => {
      await testSetup!.mockMouse.click(2, 1);
      await testSetup!.renderOnce();
    });

    expect(activatedTableRow).toBe("alpha");
  });
});
