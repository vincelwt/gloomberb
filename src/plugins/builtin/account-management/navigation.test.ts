import { describe, expect, test } from "bun:test";
import {
  consumeRequestedAccountManagementTab,
  requestAccountManagementTab,
  subscribeRequestedAccountManagementTab,
} from "./navigation";

describe("account management navigation", () => {
  test("keeps a requested tab until the account pane mounts", () => {
    requestAccountManagementTab("emails");
    expect(consumeRequestedAccountManagementTab()).toBe("emails");
    expect(consumeRequestedAccountManagementTab()).toBeNull();
  });

  test("delivers tab requests to an already-mounted account pane", () => {
    const tabs: string[] = [];
    const unsubscribe = subscribeRequestedAccountManagementTab((tab) => {
      tabs.push(tab);
    });

    requestAccountManagementTab("emails");
    unsubscribe();

    expect(tabs).toEqual(["emails"]);
    expect(consumeRequestedAccountManagementTab()).toBeNull();
  });
});
