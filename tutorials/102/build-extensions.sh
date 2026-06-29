#!/bin/sh
# Build the tutorial-102 extensions and strip their bundled @twin.org/* packages.
#
# The extensions are mounted into the twin-node image at
# /app/node_modules/@twin-community.org/<app>. Their @twin.org/* dependencies are needed only to
# BUILD (tspc type-checking); at RUNTIME they must resolve from the host node image so they share
# the platform's module instances (in particular @twin.org/context's AsyncLocalStorage). A bundled
# @twin.org/context shadows the image's copy and, on twin-node 0.9.1-next.x, leaves the node context
# unreadable, so the app's start() throws `context ID "node" is missing` and the node fails to start.
# Stripping node_modules/@twin.org after the build forces runtime resolution to the image.
#
# Run from tutorials/102 before `docker compose up -d`.
set -e
cd "$(dirname "$0")"
for app in consumer-client dataspace-example-app; do
  echo "==> Building apps/$app"
  (cd "apps/$app" && npm install && npm run dist && rm -rf node_modules/@twin.org)
done
echo "Extensions built; bundled @twin.org/* stripped (they resolve from the node image at runtime)."
