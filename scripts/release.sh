#!/usr/bin/env bash
set -euo pipefail

PROMPT=$(cat <<'EOF'
You are releasing the project "gloomberb" (a Bloomberg-style terminal stock tracker).

Use gh to:
1. Find the latest release tag and its date
2. List all merged PRs since that release
3. Decide the version bump. The project is pre-1.0, so bump the minor (0.x.0) for features/breaking changes and patch (0.x.y) for fixes/improvements. Never bump to 1.0+.

Style rules for the release title and notes:
- Keep it professional and straightforward, no hype or marketing speak
- Never use em dashes
- Title should just be the version and a short factual summary

Steps:
1. Run ./scripts/bump-version.sh <version> to bump, commit, tag, and push
2. Create the GitHub release with gh release create --draft using a short title and clean markdown release notes referencing PR numbers
EOF
)

echo "$PROMPT" | claude -p --allowedTools 'Bash(gh:*),Bash(git:*),Bash(./scripts/bump-version.sh:*)'
