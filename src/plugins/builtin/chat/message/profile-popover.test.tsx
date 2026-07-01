import { describe, expect, test } from "bun:test";
import type { ChatUserSummary } from "../../../../api-client";
import { hasPublicChatProfileInfo } from "./profile-popover";

function makeUser(overrides: Partial<ChatUserSummary>): ChatUserSummary {
  return {
    id: "u1",
    username: "vince",
    displayName: "Vince",
    profilePublic: true,
    ...overrides,
  };
}

describe("profile popover", () => {
  test("treats public portfolio analytics as hover profile information", () => {
    expect(hasPublicChatProfileInfo(makeUser({
      bio: null,
      company: null,
      title: null,
      portfolioAnalytics: {
        portfolioName: "Main Portfolio",
        holdingsCount: 12,
        oneYearReturn: 0.14,
        spyBeta: 1.05,
        marketValue: 125000,
        currency: "USD",
      },
    }))).toBe(true);
  });

  test("hides analytics when the chat profile is private", () => {
    expect(hasPublicChatProfileInfo(makeUser({
      profilePublic: false,
      portfolioAnalytics: {
        oneYearReturn: 0.14,
      },
    }))).toBe(false);
  });
});
