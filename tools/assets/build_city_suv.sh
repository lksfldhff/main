#!/usr/bin/env bash
# Builds public/models/vehicles/city_suv.glb from the Envato Elements "City SUV" model.
#
#   tools/assets/build_city_suv.sh "<path>/City SUV.blend"
#
# Needs Blender's Python module (bpy) on PYTHONPATH (or run convert_vehicle.py inside Blender)
# and the gltf-transform CLI from node_modules. The model is licensed to the user and git-ignored.
set -euo pipefail
BLEND="$(realpath "${1:?usage: build_city_suv.sh <City SUV.blend>}")"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RAW="$ROOT/.assets-raw/out/city_suv.raw.glb"
OUT="$ROOT/public/models/vehicles/city_suv.glb"
mkdir -p "$(dirname "$RAW")" "$(dirname "$OUT")"

# SS_Car_UrbanTitan.137 is a duplicate front-right tyre in the source file.
python3 "$ROOT/tools/assets/convert_vehicle.py" "$BLEND" "$RAW" \
  --root "City SUV" --exclude SS_Car_UrbanTitan.137 --budget 56000 --wheel-budget 2600

cd "$ROOT"
npx --no-install gltf-transform meshopt "$RAW" "$OUT" --level medium
ls -la "$OUT"
