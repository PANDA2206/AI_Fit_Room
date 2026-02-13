#!/usr/bin/env bash
set -euo pipefail

# Removes macOS AppleDouble files ("._*") which can break Docker build context
# transfers on some external volumes.
find . \
  -path './.git' -prune -o \
  -path './.git/*' -prune -o \
  -name '._*' -type f -print -delete
