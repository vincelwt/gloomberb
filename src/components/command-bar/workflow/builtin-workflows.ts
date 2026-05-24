import type { AppState } from "../../../state/app-context";
import type { TickerRecord } from "../../../types/ticker";
import {
  buildSetPortfolioPositionWorkflow,
} from "../../../plugins/builtin/portfolio-list/command-bar";
import type { CommandBarWorkflowRoute } from "./workflow-types";
import { buildCommandBarWorkflowRoute } from "./workflow-route-builder";

type BrokerWorkflowBuilder = (
  selectorKey: "brokerType" | "source",
  title: string,
  subtitle: string,
  submitLabel: string,
  includeManualPortfolio: boolean,
) => CommandBarWorkflowRoute | null;

export type BuiltInWorkflowRouteResult =
  | { kind: "route"; route: CommandBarWorkflowRoute }
  | { kind: "notice"; message: string }
  | { kind: "none" };

export function buildBuiltInWorkflowRoute(options: {
  actionId: string;
  activeCollectionId: string | null;
  activeTicker: TickerRecord | null;
  buildBrokerWorkflow: BrokerWorkflowBuilder;
  config: AppState["config"];
}): BuiltInWorkflowRouteResult {
  const {
    actionId,
    activeCollectionId,
    activeTicker,
    buildBrokerWorkflow,
    config,
  } = options;

  switch (actionId) {
    case "new-watchlist":
      return {
        kind: "route",
        route: buildCommandBarWorkflowRoute({
          workflowId: "builtin:new-watchlist",
          title: "New Watchlist",
          subtitle: "Create a new watchlist inside the command bar.",
          fields: [{
            id: "name",
            label: "Watchlist Name",
            type: "text",
            placeholder: "My Watchlist",
            required: true,
          }],
          values: { name: "" },
          submitLabel: "Create Watchlist",
          pendingLabel: "Creating watchlist…",
          payload: { kind: "builtin", actionId },
        }),
      };

    case "new-layout":
    case "rename-layout":
      return {
        kind: "route",
        route: buildCommandBarWorkflowRoute({
          workflowId: `builtin:${actionId}`,
          title: actionId === "new-layout" ? "New Layout" : "Rename Layout",
          fields: [{
            id: "name",
            label: "Layout Name",
            type: "text",
            placeholder: actionId === "new-layout"
              ? "Trading, Research, Overview"
              : config.layouts[config.activeLayoutIndex]?.name || "Layout name",
            required: true,
          }],
          values: { name: "" },
          submitLabel: actionId === "new-layout" ? "Create Layout" : "Rename Layout",
          pendingLabel: actionId === "new-layout" ? "Creating layout…" : "Renaming layout…",
          payload: { kind: "builtin", actionId },
        }),
      };

    case "new-portfolio": {
      const route = buildBrokerWorkflow(
        "source",
        "New Portfolio",
        "Choose a source for the new portfolio.",
        "Create Portfolio",
        true,
      );
      return route
        ? { kind: "route", route }
        : { kind: "notice", message: "No connectable brokers are installed." };
    }

    case "set-portfolio-position": {
      const workflow = buildSetPortfolioPositionWorkflow(config, {
        activeCollectionId,
        activeTicker,
      });
      if (!workflow) {
        return { kind: "notice", message: "Create a manual portfolio first." };
      }
      return {
        kind: "route",
        route: buildCommandBarWorkflowRoute({
          workflowId: "builtin:set-portfolio-position",
          title: "Set Portfolio Position",
          subtitle: "Create or update a manual position without leaving the command bar.",
          fields: workflow.fields,
          values: workflow.values,
          submitLabel: "Save Position",
          pendingLabel: workflow.pendingLabel,
          payload: { kind: "builtin", actionId },
        }),
      };
    }

    case "add-broker-account": {
      const route = buildBrokerWorkflow(
        "brokerType",
        "Add Broker Account",
        "Connect a new broker profile without leaving the command bar.",
        "Connect Broker",
        false,
      );
      return route
        ? { kind: "route", route }
        : { kind: "notice", message: "No connectable brokers are installed." };
    }

    default:
      return { kind: "none" };
  }
}
