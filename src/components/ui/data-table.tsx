import { type ComponentType } from "react";
import { useUiHost } from "../../ui";
import { OpenTuiDataTable } from "./data-table-opentui";
import type {
  DataTableColumn,
  DataTableProps,
} from "./data-table-types";

export type {
  DataTableCell,
  DataTableColumn,
  DataTableProps,
  DataTableSectionHeader,
} from "./data-table-types";

export function DataTable<T, C extends DataTableColumn = DataTableColumn>(
  props: DataTableProps<T, C>,
) {
  const HostDataTable = useUiHost().DataTable as
    | ComponentType<DataTableProps<T, C>>
    | undefined;
  if (HostDataTable) {
    return <HostDataTable {...props} />;
  }
  return <OpenTuiDataTable {...props} />;
}
