"""Mixamo character + animation FBX files -> one game-ready player.glb (Blender / bpy).

Usage (bpy as a Python module, see tools/assets/README or the player README):

  PYTHONPATH=<bpy-env> python3 tools/assets/convert_mixamo.py \
      --character "X Bot.fbx" \
      --clip idle=Breathing_Idle.fbx#loop \
      --clip walk=walking.fbx#loop \
      --clip jump=Jumping.fbx@15:31#air \
      ...                                   (full clip list: tools/assets/build_player.sh)
      --out public/models/player/player.raw.glb

  then compress:  npx gltf-transform meshopt player.raw.glb public/models/player/player.glb

Clip syntax:  name=path[@start:end][#mode][~armweight]
  start/end  frame range to keep (inclusive, source frame numbers); default: whole clip
  mode       loop    – remove the linear horizontal root drift (keeps hip sway, loops seamlessly)
             inplace – pin the horizontal hip position to its first value (one-shot transitions)
             air     – pin the hips at standing height (jumps/falls: the physics controller moves the body)
             keep    – leave root motion untouched (seated poses etc.)
  armweight  only with --target: arm animation weight for this clip (overrides --arms)

Retargeting (--target other.glb): the clips are baked onto another humanoid rig (e.g. an
image-to-3D scan with a 24-bone skeleton, see RETARGET_MAP), rest-pose aware (T-pose -> A-pose).

The natural ground speed of every clip (root travel / duration, in metres per second, measured
before the root motion is removed) is stored as JSON in the armature node's glTF extras
(`clipSpeeds`), so the game can match the playback rate to the movement speed.

The source files are Mixamo / user-licensed assets and must not be committed to the public repo.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys

import bpy  # type: ignore
from mathutils import Matrix, Quaternion, Vector  # type: ignore

HIPS = 'pose.bones["mixamorig:Hips"].location'
# Pose-space axes of the Mixamo hips bone: 0 = lateral, 1 = vertical (along the bone), 2 = forward.
HORIZONTAL = (0, 2)


def parse_clip(spec: str):
    name, rest = spec.split("=", 1)
    arms = None
    if "~" in rest:
        rest, a = rest.rsplit("~", 1)
        arms = float(a)
    mode = "loop"
    if "#" in rest:
        rest, mode = rest.rsplit("#", 1)
    rng = None
    if "@" in rest:
        rest, r = rest.rsplit("@", 1)
        a, b = r.split(":")
        rng = (int(a), int(b))
    if mode not in ("loop", "inplace", "air", "keep"):
        raise SystemExit(f"unknown mode {mode!r} in {spec!r}")
    return name.strip(), rest, rng, mode, arms


def action_fcurves(action):
    """All F-curves of an action (Blender 4.4+ layered actions and the legacy API)."""
    if hasattr(action, "layers") and len(action.layers):
        out = []
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    out.extend(bag.fcurves)
        return out
    return list(action.fcurves)


def rebuild(fc, values, first_frame=1):
    """Replace an F-curve's keys with one linear key per frame."""
    fc.keyframe_points.clear()
    fc.keyframe_points.add(len(values))
    co = []
    for i, v in enumerate(values):
        co += [first_frame + i, v]
    fc.keyframe_points.foreach_set("co", co)
    for k in fc.keyframe_points:
        k.interpolation = "LINEAR"
    fc.update()


def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.abspath(path), automatic_bone_orientation=False)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next((o for o in new if o.type == "ARMATURE"), None)
    if arm is None:
        raise SystemExit(f"{path}: no armature found")
    return arm, new


def delete_objects(objs):
    meshes = [o.data for o in objs if o.type == "MESH"]
    arms = [o.data for o in objs if o.type == "ARMATURE"]
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    for m in meshes:
        if m.users == 0:
            bpy.data.meshes.remove(m)
    for a in arms:
        if a.users == 0:
            bpy.data.armatures.remove(a)


def process_action(action, rng, mode, fps, unit):
    fcs = action_fcurves(action)
    f0, f1 = (int(round(action.frame_range[0])), int(round(action.frame_range[1])))
    if rng:
        f0, f1 = max(f0, rng[0]), min(f1, rng[1])
    frames = list(range(f0, f1 + 1))
    hips = {fc.array_index: fc for fc in fcs if fc.data_path == HIPS}

    # Natural ground speed from the horizontal root travel.
    dist = 0.0
    if 0 in hips and 2 in hips:
        dx = hips[0].evaluate(f1) - hips[0].evaluate(f0)
        dz = hips[2].evaluate(f1) - hips[2].evaluate(f0)
        dist = math.hypot(dx, dz) * unit
    duration = max(1, f1 - f0) / fps
    speed = dist / duration

    for fc in fcs:
        values = [fc.evaluate(f) for f in frames]
        if fc.data_path == HIPS:
            idx = fc.array_index
            if mode == "loop" and idx in HORIZONTAL:
                n = len(values) - 1 or 1
                d = values[-1] - values[0]
                values = [v - d * i / n for i, v in enumerate(values)]
            elif mode == "inplace" and idx in HORIZONTAL:
                values = [values[0]] * len(values)
            elif mode == "air":
                # Horizontal: pinned to the first frame; vertical: rest height (0) – the jump
                # height comes from the physics controller, the clip only provides the body pose.
                values = [values[0] if idx in HORIZONTAL else 0.0] * len(values)
        rebuild(fc, values)
    return speed, len(frames)


# --------------------------------------------------------------------------- retargeting
# Mixamo bone (without the "mixamorig:" prefix) -> candidate target bone names (first match wins).
# Covers Mixamo itself, the 24-bone rigs of common image-to-3D / auto-rig services
# (Hips, Spine02, Spine01, Spine, neck, Head, ...) and similar naming schemes.
RETARGET_MAP = {
    "Hips": ["Hips", "hips", "pelvis"],
    "Spine": ["Spine02", "spine", "Spine"],
    "Spine1": ["Spine01", "spine1", "Spine1", "chest"],
    "Spine2": ["Spine", "spine2", "Spine2", "upper_chest"],
    "Neck": ["neck", "Neck"],
    "Head": ["Head", "head"],
    **{f"{side}{part}": [f"{side}{part}"] for side in ("Left", "Right")
       for part in ("Shoulder", "Arm", "ForeArm", "Hand", "UpLeg", "Leg", "Foot", "ToeBase")},
}
# Bone whose head defines the "direction" of a bone (for matching the rest poses).
DIRECTION_CHILD = {
    "Hips": "Spine", "Spine": "Spine1", "Spine1": "Spine2", "Spine2": "Neck", "Neck": "Head",
    **{f"{s}Shoulder": f"{s}Arm" for s in ("Left", "Right")},
    **{f"{s}Arm": f"{s}ForeArm" for s in ("Left", "Right")},
    **{f"{s}ForeArm": f"{s}Hand" for s in ("Left", "Right")},
    **{f"{s}UpLeg": f"{s}Leg" for s in ("Left", "Right")},
    **{f"{s}Leg": f"{s}Foot" for s in ("Left", "Right")},
    **{f"{s}Foot": f"{s}ToeBase" for s in ("Left", "Right")},
}


def world_rot(obj, m4):
    return (obj.matrix_world @ m4).decompose()[1]



def fix_pocket_weights(tgt, meshes, max_dist=0.15):
    """Scanned characters often have their hands in the trouser pockets, so the auto-rigger binds
    trouser vertices to the arm bones and the trousers balloon when the legs move. Vertices below
    the waist that lie within `max_dist` of a thigh bone are re-bound from the arm chain to that thigh."""
    from mathutils.geometry import intersect_point_line

    mw = tgt.matrix_world
    bones = tgt.data.bones
    head = lambda n: mw @ bones[n].head_local
    hips_name = next((b.name for b in bones if b.parent is None), None)
    thighs = {}
    for side in ("Left", "Right"):
        up, knee = f"{side}UpLeg", f"{side}Leg"
        if up in bones and knee in bones:
            thighs[side] = (up, head(up), head(knee))
    if not thighs or hips_name is None:
        return 0
    waist = head(hips_name).z - 0.02
    moved = 0
    for me in meshes:
        names = {g.index: g.name for g in me.vertex_groups}
        arm_groups = {i for i, n in names.items() if re.search(r"Shoulder|Arm|Hand", n)}
        for v in me.data.vertices:
            p = me.matrix_world @ v.co
            if p.z >= waist:
                continue
            arm_w = [(g.group, g.weight) for g in v.groups if g.group in arm_groups and g.weight > 0]
            if not arm_w:
                continue
            best = None
            for side, (up, a, b) in thighs.items():
                _, t = intersect_point_line(p, a, b)
                t = max(0.0, min(1.0, t))
                d = (p - (a + (b - a) * t)).length
                if d < max_dist and (best is None or d < best[0]):
                    best = (d, up)
            if best is None:
                continue
            total = sum(w for _, w in arm_w)
            for gi, _ in arm_w:
                me.vertex_groups[names[gi]].remove([v.index])
            leg = me.vertex_groups.get(best[1]) or me.vertex_groups.new(name=best[1])
            leg.add([v.index], total, "ADD")
            moved += 1
    return moved


class Retargeter:
    """Copies Mixamo animation onto another humanoid skeleton with a different rest pose.

    Per mapped bone the world-space rotation *relative to the rest pose* of the source is applied
    to a "reference pose" of the target, i.e. the target rest pose with every bone turned so that
    it points the same way as the source rest bone (handles T-pose -> A-pose). The hips translation
    is scaled by the hip-height ratio.
    """

    def __init__(self, src, tgt, prefix="mixamorig:"):
        self.src, self.tgt, self.prefix = src, tgt, prefix
        tbones = tgt.data.bones
        self.map = {}
        for s_name, cands in RETARGET_MAP.items():
            if prefix + s_name not in src.data.bones:
                continue
            t = next((c for c in cands if c in tbones), None)
            if t:
                self.map[s_name] = t
        missing = [k for k in RETARGET_MAP if k not in self.map]
        print("retarget map:", ", ".join(f"{k}->{v}" for k, v in self.map.items()))
        if missing:
            print("  unmapped source bones:", ", ".join(missing))
        # Order target bones parents-first.
        order = []
        def visit(b):
            if b.name in self.map.values():
                order.append(b.name)
            for c in b.children:
                visit(c)
        for b in tbones:
            if b.parent is None:
                visit(b)
        self.inv_map = {v: k for k, v in self.map.items()}
        self.order = order

        sw, tw = src.matrix_world, tgt.matrix_world
        self.s_rest = {k: world_rot(src, src.data.bones[prefix + k].matrix_local) for k in self.map}
        self.t_rest_arm = {v: tgt.data.bones[v].matrix_local.to_quaternion() for v in self.map.values()}
        t_rest_w = {k: world_rot(tgt, tgt.data.bones[v].matrix_local) for k, v in self.map.items()}
        # Alignment: rotate each target rest bone onto the source rest direction.
        align = {}
        for k in self._source_order():
            child = DIRECTION_CHILD.get(k)
            if child in self.map:
                sd = (sw @ src.data.bones[prefix + child].head_local) - (sw @ src.data.bones[prefix + k].head_local)
                td = (tw @ tgt.data.bones[self.map[child]].head_local) - (tw @ tgt.data.bones[self.map[k]].head_local)
                align[k] = td.normalized().rotation_difference(sd.normalized())
            else:
                parent = src.data.bones[prefix + k].parent
                pk = parent.name[len(prefix):] if parent else None
                align[k] = align.get(pk, Quaternion())
        self.t_ref_w = {k: align[k] @ t_rest_w[k] for k in self.map}
        self.tgt_rot_inv = tw.decompose()[1].inverted()
        hs = src.data.bones[prefix + "Hips"]
        ht = tgt.data.bones[self.map["Hips"]]
        self.s_hip_rest = sw @ hs.head_local
        self.t_hip_rest = tw @ ht.head_local
        self.ratio = self.t_hip_rest.z / max(1e-6, self.s_hip_rest.z)
        print(f"  hip height ratio {self.ratio:.3f}")

    def _source_order(self):
        out = []
        def visit(b):
            k = b.name[len(self.prefix):]
            if k in self.map:
                out.append(k)
            for c in b.children:
                visit(c)
        for b in self.src.data.bones:
            if b.parent is None:
                visit(b)
        return out

    def bake(self, action, name, frames, arm_weight=1.0):
        """arm_weight < 1 blends the arm chain's local rotations towards the target rest pose –
        useful for scanned characters whose arms are fused with the body (hands in pockets)."""
        src, tgt = self.src, self.tgt
        if src.animation_data is None:
            src.animation_data_create()
        src.animation_data.action = action
        if hasattr(src.animation_data, "action_slot") and len(action.slots):
            src.animation_data.action_slot = action.slots[0]
        tbones = tgt.data.bones
        keys = {b: [] for b in self.order}  # bone -> [(loc, quat)]
        prev = {}
        for f in frames:
            bpy.context.scene.frame_set(f)
            arm_rot = {}
            for tb in self.order:
                k = self.inv_map[tb]
                pb = src.pose.bones[self.prefix + k]
                s_pose = world_rot(src, pb.matrix)
                q_w = s_pose @ self.s_rest[k].inverted() @ self.t_ref_w[k]
                arm_rot[tb] = self.tgt_rot_inv @ q_w
                bone = tbones[tb]
                if bone.parent is not None and bone.parent.name in arm_rot:
                    p = bone.parent.name
                    basis = self.t_rest_arm[tb].inverted() @ self.t_rest_arm[p] @ arm_rot[p].inverted() @ arm_rot[tb]
                    loc = Vector((0, 0, 0))
                else:
                    # Root: rotation + scaled hip translation, solved in the bone's rest frame.
                    hip_w = src.matrix_world @ pb.head
                    pos_w = self.t_hip_rest + (hip_w - self.s_hip_rest) * self.ratio
                    pos_arm = tgt.matrix_world.inverted() @ pos_w
                    m = Matrix.Translation(pos_arm) @ arm_rot[tb].to_matrix().to_4x4()
                    loc, basis, _ = (bone.matrix_local.inverted() @ m).decompose()
                basis.normalize()
                if arm_weight < 1 and re.search(r"Shoulder|Arm|Hand", k):
                    basis = Quaternion().slerp(basis, arm_weight * (0.5 if "Shoulder" in k else 1.0))
                if tb in prev and prev[tb].dot(basis) < 0:
                    basis.negate()
                prev[tb] = basis
                keys[tb].append((loc, basis))
        src.animation_data.action = None

        out = bpy.data.actions.new(name)
        out.use_fake_user = True
        if tgt.animation_data is None:
            tgt.animation_data_create()
        tgt.animation_data.action = out
        for tb, ks in keys.items():
            pb = tgt.pose.bones[tb]
            pb.rotation_mode = "QUATERNION"
            channels = [("rotation_quaternion", 4, lambda k, i: k[1][i])]
            if tbones[tb].parent is None:
                channels.append(("location", 3, lambda k, i: k[0][i]))
            for prop, n, get in channels:
                path = f'pose.bones["{tb}"].{prop}'
                for i in range(n):
                    if hasattr(out, "fcurve_ensure_for_datablock"):
                        fc = out.fcurve_ensure_for_datablock(tgt, path, index=i)
                    else:
                        fc = out.fcurves.new(path, index=i)
                    rebuild(fc, [get(k, i) for k in ks], first_frame=frames[0])
        tgt.animation_data.action = None
        return out


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--character", required=True, help="Mixamo character FBX (with skin)")
    ap.add_argument("--clip", action="append", default=[], help="name=path[@start:end][#mode]")
    ap.add_argument("--target", help="optional: other rigged character (.glb/.fbx) to retarget the animations onto; "
                    "the Mixamo character then only serves as animation source")
    ap.add_argument("--arms", type=float, default=1.0, help="retargeting: weight of the arm animation (0..1, default 1); "
                    "per clip: name=path#mode~weight")
    ap.add_argument("--pocket-fix", action="store_true", help="retargeting: re-bind trouser vertices that the "
                    "auto-rigger bound to the arms (hands in pockets) to the thighs")
    ap.add_argument("--delete", action="append", default=[], help="target-file objects to drop (stray helpers)")
    ap.add_argument("--out", required=True, help="output .glb (uncompressed; run gltf-transform meshopt afterwards)")
    args = ap.parse_args(argv)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    arm, char_objs = import_fbx(args.character)
    arm.name = "Armature"
    fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
    # Pose-space hip translation is in armature units; Mixamo FBX armatures are scaled 0.01 (cm).
    unit = arm.scale[0]
    if arm.animation_data:
        arm.animation_data.action = None
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)

    retarget = None
    owner = arm  # armature that receives the clips
    if args.target:
        before = set(bpy.data.objects)
        if args.target.lower().endswith((".glb", ".gltf")):
            bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.target))
        else:
            bpy.ops.import_scene.fbx(filepath=os.path.abspath(args.target))
        tobjs = [o for o in bpy.data.objects if o not in before]
        for o in [o for o in tobjs if o.name in args.delete]:
            tobjs.remove(o)
            bpy.data.objects.remove(o, do_unlink=True)
        tgt = next(o for o in tobjs if o.type == "ARMATURE")
        if tgt.animation_data:
            tgt.animation_data.action = None
            for t in list(tgt.animation_data.nla_tracks):
                tgt.animation_data.nla_tracks.remove(t)
        for a in list(bpy.data.actions):
            bpy.data.actions.remove(a)
        for pb in tgt.pose.bones:
            pb.rotation_mode = "QUATERNION"
            pb.location = (0, 0, 0)
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.scale = (1, 1, 1)
        bpy.context.view_layer.update()
        retarget = Retargeter(arm, tgt)
        owner = tgt
        if args.pocket_fix:
            meshes = [o for o in tobjs if o.type == "MESH"]
            print("  pocket fix: re-bound", fix_pocket_weights(tgt, meshes), "vertices to the thighs")

    speeds = {}
    for spec in args.clip:
        name, path, rng, mode, arms = parse_clip(spec)
        src_arm, objs = import_fbx(path)
        action = src_arm.animation_data.action if src_arm.animation_data else None
        if action is None:
            raise SystemExit(f"{path}: no animation")
        src_arm.animation_data.action = None
        delete_objects(objs)
        action.name = name
        action.use_fake_user = True
        speed, n = process_action(action, rng, mode, fps, unit)
        speeds[name] = round(speed, 3)
        print(f"clip {name:12s} {n:4d} frames  {n / fps:5.2f}s  speed {speed:5.2f} m/s  mode {mode}  <- {os.path.basename(path)}")

        if retarget:
            action.name = name + "_src"
            f0, f1 = int(round(action.frame_range[0])), int(round(action.frame_range[1]))
            action = retarget.bake(action, name, list(range(f0, f1 + 1)), args.arms if arms is None else arms)
            speeds[name] = round(speed * retarget.ratio, 3)

        # One NLA track per clip; the exporter turns each track into one glTF animation.
        if owner.animation_data is None:
            owner.animation_data_create()
        owner.animation_data.action = action
        if hasattr(owner.animation_data, "action_slot") and len(action.slots):
            owner.animation_data.action_slot = action.slots[0]
        track = owner.animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, int(action.frame_range[0]), action)
        strip.name = name
        track.mute = True
        owner.animation_data.action = None


    owner["clipSpeeds"] = json.dumps(speeds)

    if retarget:
        # Only the target character is exported.
        delete_objects(char_objs)
        for a in [a for a in bpy.data.actions if a.name.endswith("_src")]:
            bpy.data.actions.remove(a)
    else:
        for o in char_objs:
            if o.type == "MESH":
                o.data.name = o.name

    bpy.context.scene.frame_set(1)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(args.out),
        export_format="GLB",
        export_yup=True,
        export_apply=False,
        export_skins=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_force_sampling=True,
        export_optimize_animation_size=True,
        export_extras=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
    )
    print("wrote", args.out, "clips:", ", ".join(speeds))


if __name__ == "__main__":
    main()
