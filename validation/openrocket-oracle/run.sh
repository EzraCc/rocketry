#!/usr/bin/env bash
# One command to (re-)generate every OpenRocket comparison fixture in validation/fixtures/openrocket/.
# Cheap to re-run: no network calls (motor DB is bundled in the openrocket repo, geometry comes
# from files already in this repo), and only compiles the one small RocketryOracle.java each time.
#
# Usage:
#   validation/openrocket-oracle/run.sh
#   OPENROCKET_REPO_DIR=/path/to/openrocket validation/openrocket-oracle/run.sh   # override the default sibling-directory guess
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROCKETRY_REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OPENROCKET_REPO_DIR="${OPENROCKET_REPO_DIR:-$(cd "$ROCKETRY_REPO_DIR/../openrocket" && pwd)}"

export ROCKETRY_REPO_DIR

echo "rocketry repo:   $ROCKETRY_REPO_DIR"
echo "openrocket repo: $OPENROCKET_REPO_DIR"

cd "$OPENROCKET_REPO_DIR"
./gradlew -I "$SCRIPT_DIR/init.gradle" :core:runRocketryOracle --console=plain
