#!/bin/bash
set -e

# Get version from package.json
VERSION=$(node -p "require('./packages/devtools-electron/package.json').version")
TAG="devtools-electron-v${VERSION}"

echo "🚀 Releasing CNStra DevTools Electron v${VERSION}"
echo "📦 Tag: ${TAG}"

# Check if tag already exists
if git rev-parse "${TAG}" >/dev/null 2>&1; then
  echo "❌ Tag ${TAG} already exists!"
  exit 1
fi

# Check if working directory is clean
if ! git diff-index --quiet HEAD --; then
  echo "❌ Working directory is not clean. Please commit changes first."
  git status --short
  exit 1
fi

# Create and push tag
echo "🏷️  Creating tag ${TAG}..."
git tag -a "${TAG}" -m "Release CNStra DevTools Electron v${VERSION}"

echo "📤 Pushing tag to origin..."
git push origin "${TAG}"

echo "✅ Tag ${TAG} pushed successfully!"
echo "🔄 GitHub Actions will now build and create a release..."
echo "📋 Check progress at: https://github.com/$(git config --get remote.origin.url | sed 's/.*github.com[:/]\([^.]*\).*/\1/')/actions"
