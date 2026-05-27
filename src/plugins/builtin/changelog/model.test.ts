import { describe, expect, test } from "bun:test";
import type { ChangelogRelease } from "../../../updater/github-releases";
import {
  DEFAULT_CHANGELOG_SORT,
  nextChangelogSortPreference,
  resolveSelectedReleaseIndex,
  sortChangelogReleases,
} from "./model";

function release(
  id: string,
  version: string,
  title: string,
  publishedAt: string,
): ChangelogRelease {
  return {
    id,
    tagName: version,
    version,
    title,
    publishedAt,
    body: "",
    url: "",
  };
}

describe("changelog table model", () => {
  const releases = [
    release("8", "v0.8.0", "Desktop fixes", "2026-05-20T10:00:00Z"),
    release("10", "v0.10.0", "Accounts", "2026-05-22T10:00:00Z"),
    release("9", "v0.9.0", "Buildout", "2026-05-21T10:00:00Z"),
  ];

  test("sorts releases by newest date by default", () => {
    expect(
      sortChangelogReleases(releases, DEFAULT_CHANGELOG_SORT).map((entry) => entry.id),
    )
      .toEqual(["10", "9", "8"]);
  });

  test("sorts version tags numerically", () => {
    expect(
      sortChangelogReleases(
        releases,
        { columnId: "version", direction: "asc" },
      ).map((entry) => entry.version),
    )
      .toEqual(["v0.8.0", "v0.9.0", "v0.10.0"]);
  });

  test("cycles header sort direction without returning an undefined handler state", () => {
    const versionSort = nextChangelogSortPreference(DEFAULT_CHANGELOG_SORT, "version");
    expect(versionSort).toEqual({ columnId: "version", direction: "desc" });
    expect(nextChangelogSortPreference(versionSort, "version"))
      .toEqual({ columnId: "version", direction: "asc" });
  });

  test("ignores unknown header ids instead of creating broken sort state", () => {
    expect(nextChangelogSortPreference(DEFAULT_CHANGELOG_SORT, "missing"))
      .toBe(DEFAULT_CHANGELOG_SORT);
  });

  test("resolves selected rows by stable release id after sorting", () => {
    const sorted = sortChangelogReleases(
      releases,
      { columnId: "title", direction: "asc" },
    );

    expect(sorted.map((entry) => entry.id)).toEqual(["10", "9", "8"]);
    expect(resolveSelectedReleaseIndex(sorted, "8")).toBe(2);
  });

  test("falls back to the first release when the selected id disappears", () => {
    expect(resolveSelectedReleaseIndex(releases, "removed")).toBe(0);
    expect(resolveSelectedReleaseIndex([], "removed")).toBe(-1);
  });
});
