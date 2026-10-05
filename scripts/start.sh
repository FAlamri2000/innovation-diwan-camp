#!/bin/sh
# Container entrypoint: migrate, serve, and warm the server up.
#
# The camp sync worker lives inside the server process (src/server.ts) and
# starts when the app module loads — which Nitro does on the first request.
# The warm-up request below makes that "at boot" instead of "at the first
# visitor or health check".
set -e
node scripts/migrate.ts

node .output/server/index.mjs &
SERVER_PID=$!
trap 'kill -TERM "$SERVER_PID" 2>/dev/null' TERM INT

PORT="${PORT:-3000}" node -e '
  const url = `http://127.0.0.1:${process.env.PORT}/api/health`;
  const tryOnce = (n) => fetch(url).then(() => process.exit(0)).catch(() =>
    n > 0 ? setTimeout(() => tryOnce(n - 1), 1000) : process.exit(0));
  tryOnce(30);
' || true

set +e
wait "$SERVER_PID"
STATUS=$?
# A trapped TERM interrupts the first wait; wait again for the real exit.
if kill -0 "$SERVER_PID" 2>/dev/null; then
  wait "$SERVER_PID"
  STATUS=$?
fi
exit "$STATUS"
