import { afterEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { testRender } from "../renderers/opentui/test-utils";
import {
  AppContext,
  PaneInstanceProvider,
  createInitialState,
} from "../state/app-context";
import { createDefaultConfig } from "../types/config";
import { Box, Text } from "../ui";
import { DataTableView } from "./data-table-view";
import type { DataTableCell, DataTableColumn } from "./ui";

type Row =
  | { type: "section"; id: string; title: string }
  | { type: "row"; id: string; title: string };

type Column = DataTableColumn & { id: "title" };

const rows: Row[] = [
  { type: "section", id: "section", title: "Group" },
  { type: "row", id: "first", title: "First row" },
  { type: "row", id: "second", title: "Second row" },
];

const columns: Column[] = [
  { id: "title", label: "Title", width: 20, align: "left" },
];

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;

afterEach(async () => {
  if (!testSetup) return;
  await act(async () => {
    testSetup!.renderer.destroy();
  });
  testSetup = undefined;
});

function Harness() {
  const [selectedIndex, setSelectedIndex] = useState(1);
  const [activatedTitle, setActivatedTitle] = useState("");
  const state = createInitialState(
    createDefaultConfig("/tmp/gloomberb-data-table-view-test"),
  );
  const selectedTitle = rows[selectedIndex]?.title ?? "none";

  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId="data-table-view-test">
        <DataTableView<Row, Column>
          focused
          selectedIndex={selectedIndex}
          isNavigable={(row) => row.type === "row"}
          onSelectIndex={(index) => setSelectedIndex(index)}
          onActivateIndex={(_index, row) => {
            if (row.type === "row") setActivatedTitle(row.title);
          }}
          columns={columns}
          items={rows}
          sortColumnId={null}
          sortDirection="asc"
          onHeaderClick={() => {}}
          getItemKey={(row) => row.id}
          isSelected={(_row, index) => index === selectedIndex}
          onSelect={(_row, index) => setSelectedIndex(index)}
          renderSectionHeader={(row) => row.type === "section"
            ? { text: row.title }
            : null}
          renderCell={(row): DataTableCell => ({
            text: row.type === "row" ? row.title : "",
          })}
          emptyStateTitle="No rows"
          rootAfter={
            <Box height={1}>
              <Text>{`selected=${selectedTitle} activated=${activatedTitle}`}</Text>
            </Box>
          }
        />
      </PaneInstanceProvider>
    </AppContext>
  );
}

async function renderSettled() {
  await act(async () => {
    await testSetup!.renderOnce();
    await testSetup!.renderOnce();
  });
}

async function emitKeypress(event: { name?: string; sequence?: string }) {
  await act(async () => {
    testSetup!.renderer.keyInput.emit("keypress", {
      ctrl: false,
      meta: false,
      option: false,
      shift: false,
      eventType: "press",
      repeated: false,
      preventDefault: () => {},
      stopPropagation: () => {},
      ...event,
    } as any);
    await testSetup!.renderOnce();
  });
}

describe("DataTableView", () => {
  test("owns row keyboard navigation and skips section headers", async () => {
    testSetup = await testRender(<Harness />, { width: 60, height: 12 });

    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("selected=First row");

    await emitKeypress({ name: "j", sequence: "j" });
    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("selected=Second row");

    await emitKeypress({ name: "k", sequence: "k" });
    await emitKeypress({ name: "k", sequence: "k" });
    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("selected=First row");

    await emitKeypress({ name: "enter", sequence: "\r" });
    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("activated=First row");
  });
});
