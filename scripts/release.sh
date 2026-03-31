#!/usr/bin/env bash
set -euo pipefail

claude -p --allowedTools 'bash(gh:*)' 'bash(git:*)' "You are releasing the project \"gloomberb\" (a Bloomberg-style terminal stock tracker).

Use gh to:
1. Find the latest release tag and its date
2. List all merged PRs since that release
3. Decide the version bump. We're pre-1.0, so bump the minor (0.x.0) for features/breaking changes and patch (0.x.y) for fixes/improvements. Never bump to 1.0+.
4. Create a new GitHub release with gh release create using a catchy title and nice markdown release notes referencing PR numbers

The release tag should be vX.Y.Z. Use gh release create with --draft so I can review it before publishing.
Do NOT update package.json or push commits - the CI handles versioning from the tag."
