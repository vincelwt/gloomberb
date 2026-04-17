import { afterEach, describe, expect, test } from "bun:test";
import { act, useEffect, useRef, useState } from "react";
import { testRender } from "../../renderers/opentui/test-utils";
import { DialogProvider } from "@opentui-ui/dialog/react";
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core";
import { Button } from "./button";
import { DataTable } from "./data-table";
import { TextField } from "./fields";
import { ListView } from "./list-view";
import { MultiSelectChips } from "./multi-select-chips";
import { MultiSelectDialogButton } from "./multi-select-dialog";
import { toggleMultiSelectValue } from "./multi-select";
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
let selectedChips: string[] = [];
let tableHorizontalScrollbarVisible: boolean | null = null;

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

type SectionTableRow =
  | { kind: "header"; id: string; label: string }
  | { kind: "row"; id: string; name: string };

function DataTableSectionHarness() {
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const rows: SectionTableRow[] = [
    { kind: "header", id: "macro", label: "Macro Releases" },
    { kind: "row", id: "cpi", name: "CPI" },
  ];

  return (
    <DataTable
      columns={[{ id: "name", label: "NAME", width: 16, align: "left" }]}
      items={rows}
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
      isSelected={(row) => row.kind === "row" && row.id === selectedId}
      onSelect={(row) => {
        if (row.kind !== "row") return;
        selectedTableRow = row.id;
        setSelectedId(row.id);
      }}
      renderSectionHeader={(row) => (
        row.kind === "header" ? { text: row.label } : null
      )}
      renderCell={(row) => ({ text: row.kind === "row" ? row.name : "" })}
      emptyStateTitle="No rows."
    />
  );
}

function DataTableNoHorizontalScrollHarness() {
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  useEffect(() => {
    tableHorizontalScrollbarVisible = scrollRef.current?.horizontalScrollBar.visible ?? null;
  });

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
      isSelected={() => false}
      onSelect={() => {}}
      renderCell={(row) => ({ text: row.name })}
      emptyStateTitle="No rows."
      showHorizontalScrollbar={false}
    />
  );
}

function DataTableVirtualizationHarness() {
  const headerScrollRef = useRef<ScrollBoxRenderable>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const rows = Array.from({ length: 100 }, (_, index) => ({
    id: `row-${index}`,
    name: `Row ${index}`,
  }));

  return (
    <DataTable
      columns={[{ id: "name", label: "NAME", width: 12, align: "left" }]}
      items={rows}
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
      isSelected={() => false}
      onSelect={() => {}}
      renderCell={(row) => ({ text: row.name })}
      emptyStateTitle="No rows."
    />
  );
}

function MultiSelectChipsHarness() {
  const [values, setValues] = useState(["sma"]);
  selectedChips = values;

  return (
    <MultiSelectChips
      label="IND"
      selectedValues={values}
      onChange={setValues}
      idPrefix="indicator-chip"
      options={[
        { value: "sma", label: "SMA" },
        { value: "ema", label: "EMA" },
      ]}
    />
  );
}

function MultiSelectDialogButtonHarness() {
  const [values, setValues] = useState(["sma"]);

  return (
    <DialogProvider dialogOptions={{ style: { backgroundColor: "#000000", borderColor: "#ffffff", borderStyle: "single" } }}>
      <MultiSelectDialogButton
        label="IND"
        title="Chart Indicators"
        selectedValues={values}
        onChange={setValues}
        idPrefix="indicator-dialog"
        options={[
          { value: "sma", label: "SMA" },
          { value: "ema", label: "EMA" },
        ]}
      />
    </DialogProvider>
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
  selectedChips = [];
  tableHorizontalScrollbarVisible = null;
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

  test("scrolls overflowing tabs horizontally with the mouse wheel", async () => {
    testSetup = await testRender(
      <Tabs
        tabs={[
          { label: "Overview", value: "overview" },
          { label: "Financials", value: "financials" },
          { label: "Chart", value: "chart" },
          { label: "Options", value: "options" },
          { label: "Insider", value: "insider" },
        ]}
        activeValue="overview"
        onSelect={() => {}}
      />,
      { width: 24, height: 4 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
    });

    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("Overview");
    expect(frame).not.toContain("Insider");

    await act(async () => {
      for (let i = 0; i < 40; i++) {
        await testSetup!.mockMouse.scroll(1, 0, "down");
      }
      await testSetup!.renderOnce();
    });

    frame = testSetup.captureCharFrame();
    expect(frame).toContain("Options");
    expect(frame).toContain("Insider");
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

  test("toggles multi-select chips with the mouse", async () => {
    testSetup = await testRender(<MultiSelectChipsHarness />, { width: 32, height: 3 });

    await act(async () => {
      await testSetup!.renderOnce();
    });

    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("[x] SMA");
    expect(frame).toContain("[ ] EMA");
    const emaChip = testSetup.renderer.root.findDescendantById("indicator-chip:ema") as BoxRenderable | undefined;
    expect(emaChip).toBeDefined();

    await act(async () => {
      await testSetup!.mockMouse.click(emaChip!.x + 1, emaChip!.y);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await act(async () => {
      await testSetup!.renderOnce();
    });

    frame = testSetup.captureCharFrame();
    expect(frame).toContain("[x] SMA");
    expect(frame).toContain("[x] EMA");
    expect(selectedChips).toEqual(["sma", "ema"]);
  });

  test("opens compact multi-select dialogs from a button", async () => {
    testSetup = await testRender(<MultiSelectDialogButtonHarness />, { width: 60, height: 18 });

    await act(async () => {
      await testSetup!.renderOnce();
    });

    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("IND: SMA");
    const button = testSetup.renderer.root.findDescendantById("indicator-dialog:button") as BoxRenderable | undefined;
    expect(button).toBeDefined();
    expect(button!.width).toBe(" IND: SMA ".length);

    await act(async () => {
      await testSetup!.mockMouse.click(button!.x + 1, button!.y);
      await Promise.resolve();
      await testSetup!.renderOnce();
    });

    frame = testSetup.captureCharFrame();
    expect(frame).toContain("Chart Indicators");
    expect(frame).toContain("[✓] SMA");
    expect(frame).toContain("[ ] EMA");
    expect(frame).not.toContain("Toggle");
    expect(frame).not.toContain("space toggle");

    await act(async () => {
      await testSetup!.mockMouse.click(0, 0);
      await Promise.resolve();
      await testSetup!.renderOnce();
    });

    frame = testSetup.captureCharFrame();
    expect(frame).not.toContain("Chart Indicators");
  });

  test("keeps shared multi-select values in option order when toggling", () => {
    const options = [
      { value: "sma", label: "SMA" },
      { value: "ema", label: "EMA" },
    ];

    expect(toggleMultiSelectValue(options, ["sma"], "ema")).toEqual(["sma", "ema"]);
    expect(toggleMultiSelectValue(options, ["sma", "ema"], "sma")).toEqual(["ema"]);
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

  test("renders data table section headers as non-selectable rows", async () => {
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-test"));
    testSetup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        <PaneInstanceProvider paneId="portfolio-list:main">
          <DataTableSectionHarness />
        </PaneInstanceProvider>
      </AppContext>,
      { width: 32, height: 6 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
    });

    let frame = testSetup.captureCharFrame();
    expect(frame).toContain("Macro Releases");
    expect(frame).toContain("CPI");

    await act(async () => {
      await testSetup!.mockMouse.click(2, 1);
      await testSetup!.renderOnce();
    });
    expect(selectedTableRow).toBeNull();

    await act(async () => {
      await testSetup!.mockMouse.click(2, 2);
      await testSetup!.renderOnce();
    });

    frame = testSetup.captureCharFrame();
    expect(selectedTableRow).toBe("cpi");
    expect(frame).toContain("CPI");
  });

  test("hides data table horizontal scrolling when disabled", async () => {
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-test"));
    testSetup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        <PaneInstanceProvider paneId="portfolio-list:main">
          <DataTableNoHorizontalScrollHarness />
        </PaneInstanceProvider>
      </AppContext>,
      { width: 32, height: 5 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
      await testSetup!.renderOnce();
    });

    expect(tableHorizontalScrollbarVisible).toBe(false);
  });

  test("virtualizes data table rows by default", async () => {
    const state = createInitialState(createDefaultConfig("/tmp/gloomberb-test"));
    testSetup = await testRender(
      <AppContext value={{ state, dispatch: () => {} }}>
        <PaneInstanceProvider paneId="portfolio-list:main">
          <DataTableVirtualizationHarness />
        </PaneInstanceProvider>
      </AppContext>,
      { width: 32, height: 6 },
    );

    await act(async () => {
      await testSetup!.renderOnce();
    });

    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Row 0");
    expect(frame).not.toContain("Row 99");
  });
});
