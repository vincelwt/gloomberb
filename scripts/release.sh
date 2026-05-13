#!/usr/bin/env bash
set -euo pipefail

REPO="vincelwt/gloomberb"

usage() {
  cat <<'EOF'
Usage: ./scripts/release.sh <version>

Arguments:
  version    Version to release, in X.Y.Z format

Steps:
1. Find the latest published GitHub release
2. Run ./scripts/bump-version.sh <version> to bump, commit, tag, and push
3. Create a draft GitHub release with generated notes
EOF
}

VERSION=""

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -n "$VERSION" ]]; then
        echo "error: unexpected argument: $arg" >&2
        usage >&2
        exit 1
      fi
      VERSION="$arg"
      ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  echo "error: version is required" >&2
  usage >&2
  exit 1
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: version must be in X.Y.Z format" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

for cmd in bun gh git; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "error: required command not found: $cmd" >&2
    exit 1
  fi
done

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree must be clean before releasing" >&2
  exit 1
fi

TAG="v$VERSION"

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "error: local tag $TAG already exists" >&2
  exit 1
fi

if git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "error: remote tag $TAG already exists" >&2
  exit 1
fi

LATEST_RELEASE_TAG="$(gh release view --repo "$REPO" --json tagName --jq '.tagName' 2>/dev/null || true)"
if [[ -n "$LATEST_RELEASE_TAG" ]]; then
  echo "Latest published release: $LATEST_RELEASE_TAG"
else
  echo "Latest published release: none"
fi

./scripts/bump-version.sh "$VERSION"

create_args=(
  release create "$TAG"
  --repo "$REPO"
  --draft
  --verify-tag
  --title "$TAG"
  --generate-notes
)

if [[ -n "$LATEST_RELEASE_TAG" ]]; then
  create_args+=(--notes-start-tag "$LATEST_RELEASE_TAG")
fi

gh "${create_args[@]}"

echo "Created draft release $TAG. The tag-triggered GitHub Actions workflow will build and upload assets."
