import { type ComponentType } from "react";
import { useUiHost, type HostPopoverProps } from "../../ui";

export type PopoverProps = HostPopoverProps;

export function Popover(props: PopoverProps) {
  const HostPopover = useUiHost().Popover as ComponentType<PopoverProps> | undefined;
  if (HostPopover) return <HostPopover {...props} />;
  return <>{props.trigger}{props.open ? props.children : null}</>;
}
