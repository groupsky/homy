#!/usr/bin/env bash
# Print the commit a master CI run compares against and reuses images from.
#
# Usage: master-base-ref.sh [BEFORE_SHA]
#
# BEFORE_SHA is `github.event.before`: the master tip before this push. GitHub
# fires one run per push, for the head commit, so in a push of several commits
# HEAD^1 is an intermediate commit that never had a run and never has images.
# `before` is the last tip that did have a run (issue #1549).
#
# Falls back to HEAD^1 when BEFORE_SHA is empty (workflow_dispatch), the null
# SHA (branch creation), not in the clone, or not an ancestor of HEAD
# (force-push).
set -euo pipefail

before="${1:-}"

if [[ "$before" =~ ^[0-9a-f]{40}$ ]] &&
   [[ ! "$before" =~ ^0+$ ]] &&
   git cat-file -e "${before}^{commit}" 2>/dev/null &&
   git merge-base --is-ancestor "$before" HEAD 2>/dev/null; then
    echo "$before"
else
    git rev-parse HEAD^1
fi
