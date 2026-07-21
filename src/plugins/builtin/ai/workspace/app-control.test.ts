import { describe, expect, test } from "bun:test";
import type { RemoteControlHandler } from "../../../../remote/app-host";
import {
  LOCAL_AGENT_APP_CONTROL_INSTRUCTIONS,
  parseLocalAgentAppControlResponse,
  requestForLocalAgentAppAction,
  resolveLocalAgentAppControlOutput,
  visibleLocalAgentOutput,
  type LocalAgentAppActionProposal,
} from "./app-control";

function envelope(value: unknown): string {
  return `<gloomberb-action>${JSON.stringify(value)}</gloomberb-action>`;
}

describe("local agent app-control policy", () => {
  test("normalizes each allowed operation into a state-free call", () => {
    const cases: Array<[unknown, LocalAgentAppActionProposal["operation"], unknown]> = [
      [{ operation: "app.search", input: { mode: "ticker", query: "  apple  " }, reason: "Search" }, "app.search", { mode: "ticker", query: "apple" }],
      [{ operation: "app.switchPanel", input: { panel: "right" }, reason: "Switch" }, "app.switchPanel", { panel: "right" }],
      [{ operation: "pane.show", input: { paneId: " ticker-detail:main " }, reason: "Show" }, "pane.show", { paneId: "ticker-detail:main" }],
      [{ operation: "ticker.navigate", input: { symbol: " nvda " }, reason: "Open" }, "ticker.navigate", { symbol: "NVDA" }],
      [{ operation: "ticker.pin", input: { symbol: "btc-usd", floating: true }, reason: "Pin" }, "ticker.pin", { symbol: "BTC-USD", floating: true }],
    ];

    for (const [raw, operation, input] of cases) {
      const parsed = parseLocalAgentAppControlResponse(envelope(raw));
      expect(parsed.kind).toBe("proposal");
      if (parsed.kind !== "proposal") throw new Error("Expected a proposal");
      expect(requestForLocalAgentAppAction(parsed.proposal)).toEqual({
        type: "call",
        operation,
        input,
        include: [],
      });
    }
  });

  test("leaves ordinary assistant prose untouched", () => {
    expect(parseLocalAgentAppControlResponse("NVDA has strong data-center exposure.")).toEqual({
      kind: "message",
      content: "NVDA has strong data-center exposure.",
    });
  });

  test("rejects malformed, expanded, and privileged proposals", () => {
    const invalid = [
      "before " + envelope({ operation: "ticker.navigate", input: { symbol: "NVDA" }, reason: "Open" }),
      "<gloomberb-actionx>{}</gloomberb-actionx>",
      envelope({ operation: "ticker.navigate", input: { symbol: "NVDA" }, reason: "Open" }) + envelope({ operation: "ticker.pin", input: { symbol: "NVDA" }, reason: "Pin" }),
      "<gloomberb-action>{bad json}</gloomberb-action>",
      envelope({ operation: "ticker.navigate", input: { symbol: "NVDA" }, reason: "Open", extra: true }),
      envelope({ operation: "ticker.navigate", input: { symbol: "NVDA", sourcePaneId: "main" }, reason: "Open" }),
      envelope({ operation: "ticker.pin", input: { symbol: "NVDA", forceNewPane: true }, reason: "Pin" }),
      envelope({ operation: "ticker.pin", input: { symbol: "NVDA", paneType: "account-management" }, reason: "Pin" }),
      envelope({ operation: "capability.invoke", input: {}, reason: "Run" }),
      envelope({ operation: "ui.invoke", input: {}, reason: "Press" }),
      envelope({ operation: "layout.delete", input: {}, reason: "Delete" }),
      envelope({ operation: "ticker.navigate", input: { symbol: "NVDA;rm" }, reason: "Open" }),
      envelope({ operation: "pane.show", input: { paneId: "bad pane" }, reason: "Show" }),
      envelope({ operation: "app.search", input: { mode: "ticker", query: "x".repeat(161) }, reason: "Search" }),
      envelope({ operation: "ticker.navigate", input: { symbol: "NVDA" }, reason: "x".repeat(241) }),
      envelope({ operation: "ticker.navigate", input: { symbol: "NVDA" }, reason: "Open\nnow" }),
      envelope({ operation: "ticker.navigate", input: { symbol: "NVDA" }, reason: "Open \u202eAVDN" }),
    ];

    for (const output of invalid) {
      expect(parseLocalAgentAppControlResponse(output).kind).toBe("invalid");
    }
  });

  test("hides partial and complete action envelopes while streaming", () => {
    expect(visibleLocalAgentOutput("<gloomberb-act")).toBe("");
    expect(visibleLocalAgentOutput(envelope({ operation: "ticker.navigate", input: { symbol: "NVDA" }, reason: "Open" }))).toBe("");
    expect(visibleLocalAgentOutput("Useful context\n<gloomberb-action>{")).toBe("Useful context");
    expect(visibleLocalAgentOutput("Useful context")).toBe("Useful context");
  });

  test("advertises only the five narrow operations", () => {
    for (const operation of ["app.search", "app.switchPanel", "pane.show", "ticker.navigate", "ticker.pin"]) {
      expect(LOCAL_AGENT_APP_CONTROL_INSTRUCTIONS).toContain(operation);
    }
    for (const forbidden of ["schema", " get ", "patch", "batch", "capability", "ui.invoke", "trading"]) {
      expect(LOCAL_AGENT_APP_CONTROL_INSTRUCTIONS.toLowerCase()).not.toContain(forbidden);
    }
  });

  test("does not invoke the handler before or after denied approval", async () => {
    let settleApproval: (value: boolean) => void = () => {};
    const approval = new Promise<boolean>((resolve) => { settleApproval = resolve; });
    const requests: unknown[] = [];
    const handler: RemoteControlHandler = async (request) => {
      requests.push(request);
      return { ok: true, data: { privateState: "must not escape" } };
    };
    const pending = resolveLocalAgentAppControlOutput(
      envelope({ operation: "ticker.navigate", input: { symbol: "NVDA" }, reason: "Open" }),
      { handler, requestApproval: () => approval },
    );

    await Promise.resolve();
    expect(requests).toHaveLength(0);
    settleApproval(false);
    expect(await pending).toEqual({ kind: "cancelled", content: "Cancelled: navigate to NVDA." });
    expect(requests).toHaveLength(0);
  });

  test("invokes exactly one normalized request after one-time approval without exposing response data", async () => {
    const requests: unknown[] = [];
    const handler: RemoteControlHandler = async (request) => {
      requests.push(request);
      return { ok: true, data: { privateState: "must not escape" }, state: { rev: "secret", included: [] } };
    };
    const outcome = await resolveLocalAgentAppControlOutput(
      envelope({ operation: "ticker.pin", input: { symbol: " nvda ", floating: true }, reason: "Keep it visible" }),
      { handler, requestApproval: async () => true },
    );

    expect(requests).toEqual([{
      type: "call",
      operation: "ticker.pin",
      input: { symbol: "NVDA", floating: true },
      include: [],
    }]);
    expect(outcome).toEqual({ kind: "requested", content: "Requested: pin NVDA in a floating pane." });
    expect(JSON.stringify(outcome)).not.toContain("privateState");
    expect(JSON.stringify(outcome)).not.toContain("secret");
  });

  test("fails closed when the pane becomes inactive after approval", async () => {
    let active = true;
    let calls = 0;
    const outcome = await resolveLocalAgentAppControlOutput(
      envelope({ operation: "app.switchPanel", input: { panel: "right" }, reason: "Switch" }),
      {
        handler: async () => { calls += 1; return { ok: true, data: null }; },
        requestApproval: async () => { active = false; return true; },
        isActive: () => active,
      },
    );

    expect(outcome.kind).toBe("cancelled");
    expect(calls).toBe(0);
  });
});
