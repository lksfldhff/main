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
import bmesh  # type: ignore
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



# --------------------------------------------------------------------------- scan clean-up: free hands
SKIN_MIN_RED = 0.33


def _is_skin(c):
    r, g, b = float(c[0]), float(c[1]), float(c[2])
    return r > SKIN_MIN_RED and r > g * 1.04 and g >= b * 0.92 and r - b > 0.07


def _closest_on_chain(p, chain):
    """(distance, segment index, t in segment, projected-before-start) for a polyline."""
    best = None
    for i in range(len(chain) - 1):
        a, b = chain[i], chain[i + 1]
        ab = b - a
        L2 = ab.length_squared or 1e-12
        t = (p - a).dot(ab) / L2
        tc = max(0.0, min(1.0, t))
        d = (p - (a + ab * tc)).length
        if best is None or d < best[0]:
            best = (d, i, tc, i == 0 and t < 0)
    return best


def free_hands(tgt, me_obj, log=print):
    """Separates arms that a 3D scan fused with the body (hands in trouser pockets, forearms glued
    to the torso) and gives the character proper hands:

    * welds the scan (UV-seam splits), finds the short-sleeve hem on each upper arm from the
      texture (first skin-coloured texels below the shoulder),
    * deletes everything around the bone chain from just below the hem down to the finger tips
      (the fused forearm, the hand in the pocket and the trouser/shirt surface glued to it),
      drops left-over fragments and fills the resulting holes (new faces reuse the UVs of the
      hole border, i.e. the surrounding shirt/trouser colours),
    * builds a clean skin-coloured forearm + hand (palm, four slightly curled fingers, thumb;
      ~450 triangles per side) along the bones, UV-mapped onto the scan's own skin texels,
      skinned to Arm/ForeArm/Hand,
    * re-binds remaining torso/trouser vertices that the auto-rigger had bound to the arm bones.
    """
    import numpy as np

    mesh = me_obj.data
    mw = me_obj.matrix_world
    mwi = mw.inverted()
    amw = tgt.matrix_world
    bones = tgt.data.bones
    head = lambda n: amw @ bones[n].head_local
    img = next((n.image for m in mesh.materials if m and m.node_tree for n in m.node_tree.nodes
                if n.type == "TEX_IMAGE" and n.image), None)
    if img is None:
        log("  free hands: no base colour texture – skipped")
        return
    iw, ih = img.size
    px = np.empty(iw * ih * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(ih, iw, 4)

    def tex(uv):
        return px[int((uv[1] % 1.0) * (ih - 1)), int((uv[0] % 1.0) * (iw - 1)), :3]

    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4 / max(1e-9, mw.to_scale()[0]))
    bm.verts.ensure_lookup_table()
    uvl = bm.loops.layers.uv.active
    dl = bm.verts.layers.deform.verify()
    gidx = {g.name: g.index for g in me_obj.vertex_groups}
    for name in ("Hips", "Spine02", "Spine01", "Spine", "LeftUpLeg", "RightUpLeg"):
        if name not in gidx and name in bones:
            gidx[name] = me_obj.vertex_groups.new(name=name).index

    def vuv(v):
        return v.link_loops[0][uvl].uv.copy() if v.link_loops else Vector((0.5, 0.5))

    wpos = {v: mw @ v.co for v in bm.verts}
    hips_z = head("Hips").z
    remove = set()
    sides = {}
    for side in ("Left", "Right"):
        S, E, W = head(f"{side}Arm"), head(f"{side}ForeArm"), head(f"{side}Hand")
        d = (W - E).normalized()
        T = W + d * 0.19
        # Sleeve hem: skin texels on the upper arm surface, closest to the shoulder.
        ua = (E - S)
        ts = []
        for v, p in wpos.items():
            t = (p - S).dot(ua) / ua.length_squared
            if 0.05 < t < 1.0 and (p - (S + ua * t)).length < 0.075 and _is_skin(tex(vuv(v))):
                ts.append(t)
        ts.sort()
        hem_t = ts[int(len(ts) * 0.05)] if len(ts) > 20 else 0.5
        cut_t = min(0.8, hem_t + 0.035 / ua.length)
        H = S + ua * hem_t
        C = S + ua * cut_t
        chain = [C, E, W, T]
        radii = [0.06, 0.058, 0.055, 0.06]
        skin_kd_pts = []
        for v, p in wpos.items():
            dist, i, tc, before = _closest_on_chain(p, chain)
            if before:
                continue
            r = radii[i] + (radii[i + 1] - radii[i]) * tc
            skin = _is_skin(tex(vuv(v)))
            # Skin (the arm itself) generously, clothing only where it is glued to the arm.
            if (skin and dist < 0.1) or dist < r * 0.8:
                remove.add(v)
                c = tex(vuv(v))
                if _is_skin(c) and dist < 0.06:
                    skin_kd_pts.append((p, vuv(v)))
        sides[side] = dict(S=S, E=E, W=W, T=T, H=H, C=C, d=d, skin=skin_kd_pts)
        log(f"  free hands {side}: sleeve hem at {hem_t:.2f} of the upper arm, {len(skin_kd_pts)} skin samples")

    # Fallback skin samples: face/neck texels.
    face_skin = [(p, vuv(v)) for v, p in wpos.items() if p.z > head("neck").z and v not in remove and _is_skin(tex(vuv(v)))]

    n_removed = len(remove)
    bmesh.ops.delete(bm, geom=list(remove), context="VERTS")
    # Drop fragments that lost their connection to the body.
    seen, islands = set(), []
    for f in bm.faces:
        if f in seen:
            continue
        stack, isl = [f], []
        seen.add(f)
        while stack:
            x = stack.pop()
            isl.append(x)
            for e in x.edges:
                for g in e.link_faces:
                    if g not in seen:
                        seen.add(g)
                        stack.append(g)
        islands.append(isl)
    islands.sort(key=len, reverse=True)
    frag = [f for isl in islands[1:] if len(isl) < 400 for f in isl]
    if frag:
        bmesh.ops.delete(bm, geom=frag, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    # Fill every hole with a triangle fan around its centroid. Each new triangle uses its border
    # edge in the opposite direction of the existing neighbour face → consistent orientation,
    # works for non-planar and pinched borders where bmesh's holes_fill gives up.
    boundary = [e for e in bm.edges if e.is_boundary]
    comp, seen_e = [], set()
    for e in boundary:
        if e in seen_e:
            continue
        stack, group = [e], []
        seen_e.add(e)
        while stack:
            x = stack.pop()
            group.append(x)
            for v in x.verts:
                for y in v.link_edges:
                    if y.is_boundary and y not in seen_e:
                        seen_e.add(y)
                        stack.append(y)
        comp.append(group)
    tri = []
    for group in comp:
        verts = {v for e in group for v in e.verts}
        if len(verts) < 3:
            continue
        center = bm.verts.new(sum((v.co for v in verts), Vector()) / len(verts))
        for v in verts:
            for g, w in v[dl].items():
                center[dl][g] = center[dl].get(g, 0.0) + w / len(verts)
        for e in group:
            loop = e.link_loops[0]
            a, b = loop.vert, loop.link_loop_next.vert
            try:
                tri.append(bm.faces.new((b, a, center)))
            except ValueError:
                pass
    filled = comp
    tri_set = set(tri)
    for f in tri:
        f.smooth = True
        f.material_index = 0
    for f in tri:
        for loop in f.loops:
            other = next((l for l in loop.vert.link_loops if l.face not in tri_set), None)
            if other is not None:
                loop[uvl].uv = other[uvl].uv
        f.material_index = 0
    log(f"  free hands: removed {n_removed} vertices (+{len(frag)} fragment faces), filled {len(filled)} holes "
        f"({len(tri)} triangles), open edges left: {sum(1 for e in bm.edges if e.is_boundary)}")

    # Re-colour the patches and left-over arm texels on the shirt/trousers: each such face takes
    # the UV of the nearest clothing-coloured vertex (uniform per face → no skin streaks).
    from mathutils.kdtree import KDTree
    neck_z = head("neck").z - 0.03

    def body_zone(p):
        if p.z > neck_z:
            return False
        for sd in sides.values():
            seg = sd["C"] - sd["S"]
            t = max(0.0, min(1.0, (p - sd["S"]).dot(seg) / seg.length_squared))
            if (p - (sd["S"] + seg * t)).length < 0.075:
                return False
        return True

    fill_verts = {v for f in tri for v in f.verts}
    dark = [(mw @ v.co, vuv(v)) for v in bm.verts
            if v not in fill_verts and v.link_loops and body_zone(mw @ v.co) and not _is_skin(tex(vuv(v)))]
    kd = KDTree(len(dark))
    for i, (p, _) in enumerate(dark):
        kd.insert(p, i)
    kd.balance()
    recoloured = 0
    for f in bm.faces:
        if f not in tri_set:
            if not any(_is_skin(tex(l[uvl].uv)) for l in f.loops):
                continue
            if not all(body_zone(mw @ v.co) for v in f.verts):
                continue
        uv = dark[kd.find(mw @ f.calc_center_median())[1]][1]
        for l in f.loops:
            l[uvl].uv = uv
        recoloured += 1
    log(f"  free hands: re-coloured {recoloured} faces on shirt/trousers")

    # Re-bind vertices that still follow the arm bones but are not part of the (kept) upper arm.
    spine = [(n, head(n).z) for n in ("Spine02", "Spine01", "Spine") if n in bones]
    moved = 0
    for v in bm.verts:
        p = mw @ v.co
        dv = v[dl]
        for side, sd in sides.items():
            arm_g = [gidx.get(f"{side}{k}") for k in ("Arm", "ForeArm", "Hand")]
            ws = {g: dv[g] for g in arm_g if g is not None and g in dv}
            if not ws:
                continue
            S, C = sd["S"], sd["C"]
            seg = C - S
            t = max(0.0, min(1.0, (p - S).dot(seg) / seg.length_squared))
            on_arm = (p - (S + seg * t)).length < 0.08
            total = sum(ws.values())
            for g in ws:
                del dv[g]
            if on_arm:
                target = gidx[f"{side}Arm"]
            elif p.z < hips_z - 0.02:
                target = gidx.get(f"{side}UpLeg", gidx["Hips"])
            else:
                target = gidx[min(spine, key=lambda s: abs(s[1] - p.z))[0]] if spine else gidx["Hips"]
            dv[target] = dv.get(target, 0.0) + total
            moved += 1
    log(f"  free hands: re-bound {moved} body vertices from the arm bones")

    # ---- new forearm + hand geometry
    def add_tube(points, radii, ref, weights, uv_for, cap_start=False, cap_end=True, sides_n=10, flat=None):
        """Tube through `points` (world); `weights[i]` = {group: w}; `flat[i]` = ellipse ratio."""
        rings = []
        prev_x = None
        for i, p in enumerate(points):
            tan = (points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]).normalized()
            x = (ref - tan * ref.dot(tan)).normalized() if prev_x is None else (prev_x - tan * prev_x.dot(tan)).normalized()
            prev_x = x
            y = tan.cross(x)
            fr = flat[i] if flat else 1.0
            ring = []
            for k in range(sides_n):
                a = 2 * math.pi * k / sides_n
                off = x * (math.cos(a) * radii[i] / fr) + y * (math.sin(a) * radii[i])
                ring.append(p + off)
            rings.append(ring)
        vs = []
        for i, ring in enumerate(rings):
            row = []
            for q in ring:
                v = bm.verts.new(mwi @ q)
                for g, w in weights[i].items():
                    v[dl][gidx[g]] = w
                row.append(v)
            vs.append(row)
        faces = []
        for i in range(len(vs) - 1):
            for k in range(sides_n):
                a, b = vs[i][k], vs[i][(k + 1) % sides_n]
                c, d2 = vs[i + 1][(k + 1) % sides_n], vs[i + 1][k]
                faces.append(bm.faces.new((a, b, c, d2)))
        for end, flag in ((0, cap_start), (len(vs) - 1, cap_end)):
            if not flag:
                continue
            tan = (points[-1] - points[-2]).normalized() if end else (points[0] - points[1]).normalized()
            tip = bm.verts.new(mwi @ (points[end] + tan * radii[end] * 0.6))
            for g, w in weights[end].items():
                tip[dl][gidx[g]] = w
            ring = vs[end]
            for k in range(sides_n):
                a, b = ring[k], ring[(k + 1) % sides_n]
                cap = bm.faces.new((b, a, tip) if end else (a, b, tip))
                cap.smooth = False
                faces.append(cap)
        for f in faces:
            if len(f.verts) == 4:
                f.smooth = True
            f.material_index = 0
            for loop in f.loops:
                loop[uvl].uv = uv_for(mw @ loop.vert.co)
        # Outward normals: flip if the first quad faces the axis.
        f0 = faces[0]
        f0.normal_update()
        if f0.normal.dot(f0.calc_center_median() - mwi @ points[0]) < 0:
            bmesh.ops.reverse_faces(bm, faces=faces)
        return faces

    tri_count = 0
    for side, sd in sides.items():
        # One representative skin texel per arm (the sample closest to the median skin colour):
        # nearest-texel mapping picks up shadows/tattoo-like streaks from the scan.
        samples = sd["skin"] if len(sd["skin"]) >= 8 else face_skin
        cols = np.array([tex(uv) for _, uv in samples])
        med = np.median(cols, axis=0)
        best = int(np.argmin(((cols - med) ** 2).sum(axis=1)))
        skin_uv = samples[best][1]
        log(f"  free hands {side}: skin colour {tuple(round(float(c), 2) for c in cols[best])}")
        uv_for = lambda q, uv=skin_uv: uv
        S, E, W, H, C, d = sd["S"], sd["E"], sd["W"], sd["H"], sd["C"], sd["d"]
        Ln, Fa, Hn = f"{side}Arm", f"{side}ForeArm", f"{side}Hand"
        sign = 1.0 if W.x > 0 else -1.0
        # Hand frame: a = along the hand, n = palm normal (towards the body), t = thumb side.
        a = d
        n0 = Vector((-sign, 0.0, 0.0))
        n = (n0 - a * n0.dot(a)).normalized()
        t = a.cross(n)
        pref = Vector((0.0, -1.0, 1.0))
        if t.dot(pref - a * pref.dot(a)) < 0:
            t = -t
        # Forearm from inside the sleeve down to the wrist.
        top = H + (S - H).normalized() * 0.03
        mid = E + (W - E) * 0.5
        faces = add_tube(
            [top, C, E, mid, W],
            [0.043, 0.042, 0.038, 0.035, 0.026],
            n,
            [{Ln: 1.0}, {Ln: 1.0}, {Ln: 0.5, Fa: 0.5}, {Fa: 1.0}, {Fa: 0.5, Hn: 0.5}],
            uv_for,
            cap_start=True, cap_end=False, sides_n=12,
            flat=[1.0, 1.0, 1.0, 1.1, 1.35],
        )
        tri_count += len(faces) * 2
        # Palm: rounded box from the wrist to the knuckles.
        palm_pts = [W + a * s for s in (-0.01, 0.03, 0.065, 0.092)]
        faces = add_tube(palm_pts, [0.03, 0.041, 0.043, 0.041], n, [{Hn: 1.0}] * 4, uv_for,
                         cap_start=True, cap_end=True, sides_n=10, flat=[1.6, 2.3, 2.6, 2.8])
        tri_count += len(faces) * 2
        # Fingers (index on the thumb side), relaxed curl towards the palm.
        for off, length, rad in ((0.026, 0.074, 0.0095), (0.009, 0.082, 0.0100), (-0.009, 0.077, 0.0095), (-0.025, 0.062, 0.0085)):
            base = W + a * 0.085 + t * off + n * 0.002
            pts, direc = [base], a.copy()
            for frac, ang in ((0.45, 12), (0.3, 22), (0.25, 18)):
                direc = Quaternion(t, math.radians(ang) * (1 if t.cross(a).dot(n) > 0 else -1)) @ direc
                pts.append(pts[-1] + direc * length * frac)
            faces = add_tube(pts, [rad, rad * 0.95, rad * 0.88, rad * 0.8], n, [{Hn: 1.0}] * 4, uv_for, sides_n=6)
            tri_count += len(faces) * 2
        # Thumb.
        base = W + a * 0.02 + t * 0.03 + n * 0.008
        direc = (a * 0.85 + t * 0.45 + n * 0.3).normalized()
        pts = [base]
        for frac, ang in ((0.4, 10), (0.32, 18), (0.28, 15)):
            direc = Quaternion(a, math.radians(ang) * (1 if a.cross(t).dot(n) > 0 else -1)) @ direc
            pts.append(pts[-1] + direc * 0.068 * frac)
        faces = add_tube(pts, [0.0125, 0.0115, 0.0105, 0.009], n, [{Hn: 1.0}] * 4, uv_for, sides_n=6)
        tri_count += len(faces) * 2

    # Normalise weights.
    for v in bm.verts:
        dv = v[dl]
        tot = sum(dv.values())
        if tot > 0:
            for g in list(dv.keys()):
                dv[g] = dv[g] / tot
    bm.to_mesh(mesh)
    bm.free()
    if "custom_normal" in mesh.attributes:
        mesh.attributes.remove(mesh.attributes["custom_normal"])
    mesh.shade_smooth()
    log(f"  free hands: added ~{tri_count} triangles of forearm/hand geometry")


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
    ap.add_argument("--free-hands", action="store_true", help="retargeting: cut fused arms/hands of a scanned "
                    "character free and build clean forearms + hands (see free_hands)")
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
        meshes = [o for o in tobjs if o.type == "MESH"]
        if args.pocket_fix:
            print("  pocket fix: re-bound", fix_pocket_weights(tgt, meshes), "vertices to the thighs")
        if args.free_hands:
            for m in meshes:
                free_hands(tgt, m)

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
