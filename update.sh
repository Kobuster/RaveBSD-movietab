#!/bin/sh
# Updates this movies fork of RaveBSD and restarts it. Your settings, shelf, books, movies and scrapers are not touched.
#
#   ./update.sh            your fork's own changes (git pull, when the branch tracks a remote), then rebuild
#   ./update.sh upstream   also merge the newest original RaveBSD (github.com/IdleEndeavor/RaveBSD), then rebuild
#
# The fork is always built here, never pulled: the published image has no movies.
set -e
cd "$(dirname "$0")"

if [ "$1" = "upstream" ]; then
    git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/IdleEndeavor/RaveBSD.git
    git fetch upstream
    if ! git merge --no-edit upstream/main; then
        echo "The original RaveBSD changed lines this fork changes too. Fix the files 'git status' lists, then 'git commit' and run ./update.sh again."
        exit 1
    fi
elif [ -d .git ] && git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    git pull --ff-only || echo "Could not pull (local changes?). Rebuilding what is here."
fi

# --pull fetches a newer Node base image (security fixes) before building.
docker compose build --pull ravebsd
# Optional services you switched on in compose.yaml (qBittorrent, Gluetun) are pulled as usual.
others=$(docker compose config --services | grep -v '^ravebsd$' || true)
[ -n "$others" ] && docker compose pull $others
docker compose up -d
docker image prune -f > /dev/null
echo "RaveBSD (movies) is up to date."
