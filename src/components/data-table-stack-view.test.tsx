import { afterEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import {
  AppContext,
  PaneInstanceProvider,
  createInitialState,
} from "../state/app-context";
import { createDefaultConfig } from "../types/config";
import { DataTableStackView } from "./data-table-stack-view";
import type { DataTableCell, DataTableColumn } from "./ui";

interface Row {
  id: string;
  title: string;
  body: string;
}

type Column = DataTableColumn & { id: "title" };

const rows: Row[] = [
  { id: "first", title: "First row", body: "First detail" },
  { id: "second", title: "Second row", body: "Second detail" },
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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [openRow, setOpenRow] = useState<Row | null>(null);
  const state = createInitialState(
    createDefaultConfig("/tmp/gloomberb-data-table-stack-view-test"),
  );
  const columns: Column[] = [
    { id: "title", label: "Title", width: 20, align: "left" },
  ];

  return (
    <AppContext value={{ state, dispatch: () => {} }}>
      <PaneInstanceProvider paneId="portfolio-list:main">
        <DataTableStackView<Row, Column>
          focused
          detailOpen={!!openRow}
          onBack={() => setOpenRow(null)}
          detailContent={
            openRow ? (
              <box flexGrow={1}>
                <text>{openRow.body}</text>
              </box>
            ) : (
              <box flexGrow={1} />
            )
          }
          selectedIndex={selectedIndex}
          onSelectIndex={(index) => setSelectedIndex(index)}
          onActivateIndex={(_index, row) => setOpenRow(row)}
          columns={columns}
          items={rows}
          sortColumnId={null}
          sortDirection="asc"
          onHeaderClick={() => {}}
          getItemKey={(row) => row.id}
          isSelected={(_row, index) => index === selectedIndex}
          onSelect={(_row, index) => setSelectedIndex(index)}
          onActivate={(row) => setOpenRow(row)}
          renderCell={(row): DataTableCell => ({ text: row.title })}
          emptyStateTitle="No rows"
          showHorizontalScrollbar={false}
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

describe("DataTableStackView", () => {
  test("owns table navigation, detail open, and back navigation", async () => {
    testSetup = await testRender(<Harness />, { width: 60, height: 12 });

    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("First row");
    expect(testSetup.captureCharFrame()).not.toContain("j/k move");

    await emitKeypress({ name: "j", sequence: "j" });
    await emitKeypress({ name: "enter", sequence: "\r" });
    await renderSettled();

    const detailFrame = testSetup.captureCharFrame();
    expect(detailFrame).toContain("<- Back");
    expect(detailFrame).toContain("Second detail");

    await emitKeypress({ name: "escape", sequence: "\u001b" });
    await renderSettled();
    expect(testSetup.captureCharFrame()).toContain("Second detail");

    await emitKeypress({ name: "backspace", sequence: "\u007f" });
    await renderSettled();

    const rootFrame = testSetup.captureCharFrame();
    expect(rootFrame).toContain("Second row");
    expect(rootFrame).not.toContain("Second detail");
  });
});
