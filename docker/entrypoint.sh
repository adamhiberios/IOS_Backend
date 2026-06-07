#!/bin/sh
# =============================================================================
# IOS LMS API — Production container entrypoint
#
# Runs database migrations against the compiled DataSource, then execs the
# Node process. exec replaces the shell so tini (PID 1) keeps forwarding
# signals correctly to Node.
# =============================================================================
set -eu

echo "[entrypoint] running database migrations..."
node ./node_modules/typeorm/cli.js migration:run \
  -d ./dist/database/config/typeorm.config.js

echo "[entrypoint] migrations complete, starting api..."
exec node dist/main
