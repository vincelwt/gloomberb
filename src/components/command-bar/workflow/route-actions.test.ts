import { expect, test } from "bun:test";
import type { CommandBarRoute } from "./types";
import { updateRouteStack } from "./route-actions";

test("changing a workflow selector clears its dependent value", () => {
  let routes: CommandBarRoute[] = [{
    kind: "workflow",
    workflowId: "ai",
    title: "AI Agent",
    fields: [{
      id: "providerId",
      label: "Provider",
      type: "select",
      options: [],
      clearOnChange: ["modelId"],
    }],
    values: { providerId: "claude", modelId: "opus" },
    activeFieldId: "providerId",
    submitLabel: "Create",
    pending: false,
    error: null,
    payload: { kind: "pane-template", actionId: "ai" },
  }];

  updateRouteStack((updater) => {
    routes = typeof updater === "function" ? updater(routes) : updater;
  }, "providerId", "codex");

  const route = routes[0];
  expect(route?.kind === "workflow" ? route.values : null).toEqual({
    providerId: "codex",
    modelId: "",
  });
});
