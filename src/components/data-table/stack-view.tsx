import { useShortcut } from "../../react/input";
import { type ReactNode } from "react";
import {
  DataTableView,
  type DataTableKeyEvent,
  type DataTableViewProps,
} from "./view";
import { PageStackView, type DataTableColumn } from "../ui";

export interface DataTableStackViewProps<
  T,
  C extends DataTableColumn = DataTableColumn,
> extends Omit<DataTableViewProps<T, C>, "focused" | "selectedIndex"> {
  focused: boolean;
  detailOpen: boolean;
  onBack: () => void;
  detailContent: ReactNode;
  detailTitle?: string;
  selectedIndex: number;
  onDetailKeyDown?: (event: DataTableKeyEvent) => boolean | void;
}

export function DataTableStackView<
  T,
  C extends DataTableColumn = DataTableColumn,
>({
  focused,
  detailOpen,
  onBack,
  detailContent,
  detailTitle,
  keyboardNavigation = true,
  onDetailKeyDown,
  ...tableProps
}: DataTableStackViewProps<T, C>) {
  useShortcut((event) => {
    if (!focused || !detailOpen || !keyboardNavigation) return;
    onDetailKeyDown?.(event);
  });

  const rootContent = (
    <DataTableView<T, C>
      {...tableProps}
      focused={focused && !detailOpen}
      keyboardNavigation={keyboardNavigation}
    />
  );

  return (
    <PageStackView
      focused={focused}
      detailOpen={detailOpen}
      onBack={onBack}
      rootContent={rootContent}
      detailContent={detailContent}
      detailTitle={detailTitle}
    />
  );
}
