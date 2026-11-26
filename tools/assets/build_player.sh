#!/usr/bin/env bash
# Builds public/models/player/player.glb from Mixamo downloads (X Bot + animations).
#
#   tools/assets/build_player.sh <dir-with-fbx-files> [own-character.glb]
#
# With a second argument the Mixamo animations are retargeted onto that rigged character
# (e.g. an image-to-3D scan of yourself with a 24-bone auto-rig; stray helper objects named
# "Icosphere" are dropped). The X Bot then only serves as animation source.
#
# Expected files in <dir> (Mixamo names; the "Locomotion Pack" zip provides the lower-case ones):
#   "X Bot.fbx", Breathing_Idle.fbx, Walking.fbx, Running.fbx, Running1.fbx, Jumping.fbx,
#   Jumping_Down1.fbx, Start_Walking.fbx, Stop_Walking.fbx, "left turn 90.fbx", "right turn 90.fbx",
#   "left strafe walking.fbx", "right strafe walking.fbx", Driving.fbx, Sitting_Idle.fbx
#
# Needs Blender's Python module (bpy) on PYTHONPATH (or run inside Blender) and the
# gltf-transform CLI from node_modules. "~0.5" after a clip = arm animation weight for that clip
# (only with a retarget target: keeps the scanned sleeves from tearing when the arms go up). The result is user-licensed (Mixamo) and git-ignored.
set -euo pipefail
SRC="$(cd "${1:?usage: build_player.sh <fbx-dir> [character.glb]}" && pwd)"
TARGET_ARGS=()
if [ -n "${2:-}" ]; then
  # Scanned characters have their arms/hands fused with the body (hands in the pockets):
  # --free-hands cuts the forearms free, fills the holes and builds clean forearms + hands,
  # --pocket-fix re-binds trouser vertices from the arm bones to the thighs; full arm animation.
  TARGET_ARGS=(--target "$(realpath "$2")" --delete Icosphere --arms 1.0 --pocket-fix --free-hands)
fi
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RAW="$ROOT/.assets-raw/out/player.raw.glb"
OUT="$ROOT/public/models/player/player.glb"
mkdir -p "$(dirname "$RAW")"

python3 "$ROOT/tools/assets/convert_mixamo.py" --character "$SRC/X Bot.fbx" "${TARGET_ARGS[@]}" \
  --clip "idle=$SRC/Breathing_Idle.fbx#loop" \
  --clip "walk=$SRC/Walking.fbx#loop" \
  --clip "run=$SRC/Running1.fbx#loop" \
  --clip "sprint=$SRC/Running.fbx#loop" \
  --clip "jump=$SRC/Jumping.fbx@15:31#air~0.55" \
  --clip "fall=$SRC/Jumping_Down1.fbx@36:45#air~0.45" \
  --clip "land=$SRC/Jumping.fbx@34:52#inplace" \
  --clip "start_walk=$SRC/Start_Walking.fbx#inplace" \
  --clip "stop_walk=$SRC/Stop_Walking.fbx#inplace" \
  --clip "turn_left=$SRC/left turn 90.fbx#inplace" \
  --clip "turn_right=$SRC/right turn 90.fbx#inplace" \
  --clip "strafe_left=$SRC/left strafe walking.fbx#loop" \
  --clip "strafe_right=$SRC/right strafe walking.fbx#loop" \
  --clip "drive=$SRC/Driving.fbx#keep" \
  --clip "sit=$SRC/Sitting_Idle.fbx#keep" \
  --out "$RAW"

cd "$ROOT"
TMP="$ROOT/.assets-raw/out/player.tex.glb"
# Textures (scans ship 4K JPEGs): 2048 px WebP. No-op for untextured characters.
npx --no-install gltf-transform resize "$RAW" "$TMP" --width 2048 --height 2048
npx --no-install gltf-transform webp "$TMP" "$TMP" --quality 88
npx --no-install gltf-transform meshopt "$TMP" "$OUT" --level medium
ls -la "$OUT"
