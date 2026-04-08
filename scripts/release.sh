#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./scripts/release.sh [version]

Options:
  version    Optional version to force Claude to use for the release, in X.Y.Z format
  -h, --help Show this help text
EOF
}

FORCED_VERSION=""

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -n "$FORCED_VERSION" ]]; then
        echo "error: unexpected argument: $arg" >&2
        usage >&2
        exit 1
      fi
      FORCED_VERSION="$arg"
      ;;
  esac
done

if [[ -n "$FORCED_VERSION" && ! "$FORCED_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: version must be in X.Y.Z format" >&2
  exit 1
fi

VERSION_INSTRUCTIONS=$(cat <<EOF
3. Use the provided version exactly: $FORCED_VERSION
EOF
)

if [[ -z "$FORCED_VERSION" ]]; then
  VERSION_INSTRUCTIONS=$(cat <<'EOF'
3. Decide the version bump. The project is pre-1.0, so bump the minor (0.x.0) for features/breaking changes and patch (0.x.y) for fixes/improvements. Never bump to 1.0+.
EOF
)
fi

PROMPT=$(cat <<EOF
You are releasing the project "gloomberb" (a Bloomberg-style terminal stock tracker).

Use gh to:
1. Find the latest release tag and its date
2. List all merged PRs since that release
${VERSION_INSTRUCTIONS}

Style rules for the release title and notes:
- Keep it professional and straightforward, no hype or marketing speak
- Never use em dashes
- Title should just be the version and a short factual summary

Steps:
1. Run ./scripts/bump-version.sh ${FORCED_VERSION:-<version>} to bump, commit, tag, and push
2. Create the GitHub release using a short title and clean markdown release notes referencing PR numbers. IMPORTANT: Always pass --draft to gh release create so it is not published immediately.
EOF
)

echo "$PROMPT" | claude -p --allowedTools 'Bash(gh:*),Bash(git:*),Bash(./scripts/bump-version.sh:*)'
