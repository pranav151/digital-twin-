#!/usr/bin/env bash
# Draco-compress + texture-optimize a .glb for the web. This is the exact step used
# to shrink the bundled demo models (CommercialRefrigerator 10.1 MB → 1.26 MB,
# AntiqueCamera 17.5 MB → 0.58 MB). Requires Node (npx fetches the tool).
#
#   tools/3d-pipeline/optimize_glb.sh input.glb frontend/public/models/MyMachine.glb
#
set -euo pipefail
IN="${1:?usage: optimize_glb.sh <input.glb> <output.glb> [texture-size]}"
OUT="${2:?output path required}"
TEX="${3:-1024}"

npx --yes @gltf-transform/cli@latest optimize "$IN" "$OUT" \
  --compress draco \
  --texture-compress webp \
  --texture-size "$TEX"

echo "optimized: $IN -> $OUT"
