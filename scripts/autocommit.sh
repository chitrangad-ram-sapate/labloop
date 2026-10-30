#!/usr/bin/env bash
# Commits and pushes any changes every N minutes as this machine's git user.
# Each teammate runs it on their own machine.  Usage: scripts/autocommit.sh [minutes]
interval=$(( ${1:-15} * 60 ))
cd "$(git rev-parse --show-toplevel)" || exit 1
while true; do
  if [ -n "$(git status --porcelain)" ]; then
    git add -A
    files=$(git diff --cached --name-only)
    git commit -q -m "wip: update $(echo "$files" | wc -l | tr -d ' ') file(s): $(echo "$files" | head -3 | tr '\n' ' ')"
    git pull -q --rebase && git push -q || echo "push failed, retrying next round"
  fi
  sleep "$interval"
done
