#!/usr/bin/env bash
set -e
root_dir="$(dirname "$0")/.."
cd "$root_dir"
trap 'kill 0' SIGINT SIGTERM EXIT
(cd frontend && npm run dev) &
(cd backend && npm run dev) &
wait
