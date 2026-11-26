"""Detailed car .blend (e.g. "City SUV" from Envato Elements) -> light game GLB (Blender / bpy).

Usage:
  PYTHONPATH=<bpy-env> python3 tools/assets/convert_vehicle.py "City SUV.blend" out.raw.glb \
      --root "City SUV" --exclude SS_Car_UrbanTitan.137 --budget 56000
  npx gltf-transform meshopt out.raw.glb public/models/vehicles/city_suv.glb

What it does:
  * keeps the visible meshes below --root (helpers, hidden and tiny parts are dropped),
  * limits Subdivision Surface modifiers to --subdiv levels and applies all modifiers (mirror, bevel, ...),
  * replaces the Cycles node materials by a small set of glTF PBR materials (see MATERIALS;
    the body paint is called "paint" so the game can recolour it, the brake lights "taillight",
    glass stays transparent),
  * detects the four wheels from the empties they are parented to and exports them as separate
    nodes wheel_fl / wheel_fr / wheel_rl / wheel_rr with their origin at the hub (the game
    spins/steers them); everything else is joined into one "body" node,
  * decimates every part to fit the triangle budget,
  * re-orients the car: forward = glTF +Z, up = +Y, ground at y = 0, wheelbase centre at the origin.

The source model is licensed to the user (Envato Elements) and must not be committed; the
output is git-ignored as well (public/models/vehicles/).
"""
from __future__ import annotations

import argparse
import math
import re
import sys

import bpy  # type: ignore  (must come before bmesh/mathutils)
import bmesh  # type: ignore
from mathutils import Matrix, Vector  # type: ignore

# name -> (linear base colour, metallic, roughness, alpha, emissive colour or None)
MATERIALS = {
    "paint": ((0.65, 0.13, 0.0), 0.45, 0.32, 1.0, None),
    "trim": ((0.012, 0.012, 0.013), 0.2, 0.45, 1.0, None),
    "plastic": ((0.02, 0.02, 0.022), 0.0, 0.8, 1.0, None),
    "chrome": ((0.7, 0.7, 0.72), 1.0, 0.18, 1.0, None),
    "metal": ((0.35, 0.35, 0.36), 0.9, 0.4, 1.0, None),
    "rim": ((0.55, 0.56, 0.58), 0.9, 0.3, 1.0, None),
    "tyre": ((0.025, 0.025, 0.025), 0.0, 0.9, 1.0, None),
    "caliper": ((0.35, 0.02, 0.02), 0.3, 0.4, 1.0, None),
    "leather": ((0.42, 0.2, 0.09), 0.0, 0.6, 1.0, None),
    "wood": ((0.2, 0.09, 0.035), 0.0, 0.45, 1.0, None),
    "glass": ((0.03, 0.04, 0.045), 0.0, 0.05, 0.38, None),
    "headlight_glass": ((0.8, 0.82, 0.85), 0.0, 0.05, 0.22, None),
    "headlight": ((0.9, 0.9, 0.88), 0.0, 0.2, 1.0, (1.0, 0.95, 0.85)),
    "taillight": ((0.5, 0.015, 0.01), 0.0, 0.25, 1.0, (1.0, 0.04, 0.02)),
}

# Source material name (regex, first match wins) -> game material.
MATERIAL_RULES = [
    (r"^car_paint\.002", "paint"),
    (r"^car_paint", "trim"),
    (r"^Metal$", "chrome"),
    (r"^metal$", "trim"),
    (r"^Wendscreen", "glass"),
    (r"^Hed_light_glass", "headlight_glass"),
    (r"^tail_light_glass|^BK$|^BR$|^TLq$|^TRq$", "taillight"),
    (r"^TL$|^TR$|^D$|^lights", "headlight"),
    (r"^tyre", "tyre"),
    (r"^Rim\.001|^wheel metal black|^brake$", "metal"),
    (r"^Rim|^wheel metal", "rim"),
    (r"^break_Caliper", "caliper"),
    (r"^creamcolur_intereor\.001", "plastic"),
    (r"^creamcolur", "leather"),
    (r"^Wood", "wood"),
    (r"^chrome_for_small|^light_chrome|^interior metal$|^interior metal\.001|^miror", "metal"),
    (r"^chrome", "metal"),
    (r"^Material\.010|^beading|^front_buffer", "trim"),
    (r".*", "plastic"),
]


# Decimation weight per game material (relative share of the triangle budget).
IMPORTANCE = {"paint": 2.2, "glass": 1.6, "chrome": 1.2, "leather": 0.5, "wood": 0.4, "plastic": 0.6, "metal": 0.6}


def main_material(obj) -> str:
    """Game material covering most faces of an (already remapped) object."""
    counts = {}
    for p in obj.data.polygons:
        if p.material_index < len(obj.data.materials) and obj.data.materials[p.material_index]:
            name = obj.data.materials[p.material_index].name
            counts[name] = counts.get(name, 0) + 1
    return max(counts, key=counts.get) if counts else "plastic"


def game_material(src_name: str) -> str:
    for pattern, name in MATERIAL_RULES:
        if re.search(pattern, src_name or ""):
            return name
    return "plastic"


def make_materials():
    mats = {}
    for name, (col, met, rough, alpha, emissive) in MATERIALS.items():
        clash = bpy.data.materials.get(name)
        if clash is not None:
            clash.name = name + "_src"  # keep the game names exact (the game looks them up)
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bsdf.inputs["Base Color"].default_value = (*col, 1.0)
        bsdf.inputs["Metallic"].default_value = met
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Alpha"].default_value = alpha
        if emissive:
            bsdf.inputs["Emission Color"].default_value = (*emissive, 1.0)
            bsdf.inputs["Emission Strength"].default_value = 0.3
        if alpha < 1:
            if hasattr(m, "surface_render_method"):
                m.surface_render_method = "BLENDED"
            if hasattr(m, "blend_method"):
                m.blend_method = "BLEND"
        mats[name] = m
    return mats


def descendants(obj):
    out = []
    for c in obj.children:
        out.append(c)
        out.extend(descendants(c))
    return out


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def evaluated_copy(obj, depsgraph, mats, name):
    """Applies modifiers and the world transform, remaps materials; returns a new object."""
    ev = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=False, depsgraph=depsgraph)
    mesh.transform(obj.matrix_world)
    if obj.matrix_world.determinant() < 0:
        mesh.flip_normals()
    for i, slot in enumerate(mesh.materials):
        mesh.materials[i] = mats[game_material(slot.name if slot else "")]
    if not mesh.materials:
        mesh.materials.append(mats["plastic"])
    # Drop UVs and colour attributes: the game materials are untextured.
    while mesh.uv_layers:
        mesh.uv_layers.remove(mesh.uv_layers[0])
    while mesh.color_attributes:
        mesh.color_attributes.remove(mesh.color_attributes[0])
    new = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(new)
    return new


def decimate(obj, ratio):
    if ratio >= 0.999:
        return
    mod = obj.modifiers.new("dec", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = max(0.005, ratio)
    mod.use_collapse_triangulate = True
    with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj]):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def join(objs, name):
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, selected_objects=objs):
        bpy.ops.object.join()
    objs[0].name = name
    objs[0].data.name = name
    return objs[0]


def finish_shading(obj, angle_deg=40):
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=0.0002)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    if hasattr(me, "set_sharp_from_angle"):
        me.set_sharp_from_angle(angle=math.radians(angle_deg))


def budget_ratio(counts, budget, floor):
    """Global ratio r so that sum(max(min(n, floor), n * r)) ~= budget."""
    lo, hi = 0.0, 1.0
    for _ in range(40):
        r = (lo + hi) / 2
        total = sum(max(min(n, floor), n * r) for n in counts)
        if total > budget:
            hi = r
        else:
            lo = r
    return lo


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("blend")
    ap.add_argument("out")
    ap.add_argument("--root", required=True, help="top object of the car hierarchy")
    ap.add_argument("--exclude", action="append", default=[], help="object names to drop (duplicates, helpers)")
    ap.add_argument("--forward", default="-Y", choices=["-Y", "+Y", "-X", "+X"], help="car forward axis in Blender")
    ap.add_argument("--budget", type=int, default=56000, help="total triangle budget")
    ap.add_argument("--wheel-budget", type=int, default=2600, help="triangles per wheel")
    ap.add_argument("--subdiv", type=int, default=1, help="max subdivision level kept before decimation")
    ap.add_argument("--min-size", type=float, default=0.05, help="drop parts smaller than this (bbox diagonal, m)")
    ap.add_argument("--static-material", action="append", default=["caliper"], help="wheel parts with this game material stay on the body (no spin)")
    args = ap.parse_args(argv)

    bpy.ops.wm.open_mainfile(filepath=args.blend)
    root = bpy.data.objects[args.root]
    parts = [o for o in descendants(root) if o.type == "MESH" and not o.hide_render and o.name not in args.exclude]
    # One subdivision level puts the cage close to the smooth limit surface (much cleaner than
    # decimating the raw cage); the decimation below then brings it down to the budget.
    for o in parts:
        for m in list(o.modifiers):
            if m.type == "SUBSURF":
                m.levels = m.render_levels = min(m.render_levels, args.subdiv)
                if m.levels == 0:
                    o.modifiers.remove(m)
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mats = make_materials()

    # Wheel groups: meshes parented (directly or indirectly) to an empty that is not the body empty.
    # Body empty = the empty with the most mesh descendants.
    empties = [o for o in descendants(root) if o.type == "EMPTY"]
    body_empty = max(empties, key=lambda e: len([d for d in descendants(e) if d.type == "MESH"])) if empties else None
    hubs = {}  # rounded location -> list of meshes

    def hub_of(o):
        p = o.parent
        while p is not None and p is not root:
            if p.type == "EMPTY" and p is not body_empty:
                return p
            p = p.parent
        return None

    body_objs, wheel_objs = [], {}
    for o in parts:
        ev = o.evaluated_get(depsgraph)
        corners = [o.matrix_world @ Vector(c) for c in ev.bound_box]
        diag = (Vector([max(c[i] for c in corners) for i in range(3)]) - Vector([min(c[i] for c in corners) for i in range(3)])).length
        hub = hub_of(o)
        if diag < args.min_size and hub is None:
            continue
        copy = evaluated_copy(o, depsgraph, mats, o.name + "_game")
        if tri_count(copy) == 0:
            bpy.data.objects.remove(copy)
            continue
        if hub is not None:
            key = tuple(round(v, 2) for v in hub.matrix_world.translation)
            static = all(game_material(s.name) in args.static_material for s in o.material_slots if s.material) and o.material_slots
            if static:
                body_objs.append(copy)
            else:
                wheel_objs.setdefault(key, []).append(copy)
        else:
            body_objs.append(copy)

    for o in parts:
        o.hide_set(True)
    for o in list(bpy.context.scene.objects):
        if not o.name.endswith("_game"):
            bpy.data.objects.remove(o)

    if len(wheel_objs) != 4:
        print(f"WARNING: expected 4 wheel groups, found {len(wheel_objs)} – wheels stay in the body")
        for objs in wheel_objs.values():
            body_objs.extend(objs)
        wheel_objs = {}

    # Orientation: rotate so the car faces Blender -Y (= glTF +Z after the Y-up conversion).
    rot = {"-Y": 0.0, "+Y": math.pi, "-X": -math.pi / 2, "+X": math.pi / 2}[args.forward]
    R = Matrix.Rotation(rot, 4, "Z")
    hub_pos = {k: R @ Vector(k) for k in wheel_objs}
    if hub_pos:
        cx = sum(v.x for v in hub_pos.values()) / 4
        cy = sum(v.y for v in hub_pos.values()) / 4
    else:
        cx = cy = 0.0
    all_objs = body_objs + [o for objs in wheel_objs.values() for o in objs]
    min_z = min(min((o.matrix_world @ v.co).z for v in o.data.vertices) for o in all_objs)
    T = Matrix.Translation((-cx, -cy, -min_z)) @ R
    for o in all_objs:
        o.data.transform(T)

    # Decimate: wheels to a fixed budget, the body to the remainder.
    wheels = {}
    for key, objs in wheel_objs.items():
        hub = T @ Vector(key)
        # Blender: forward -Y, left +X (car faces -Y, so its left side is +X).
        side = "l" if hub.x > 0 else "r"
        axle = "f" if hub.y < 0 else "r"
        name = f"wheel_{axle}{side}"
        counts = [tri_count(o) for o in objs]
        r = budget_ratio(counts, args.wheel_budget, 60)
        for o, n in zip(objs, counts):
            decimate(o, max(r, min(1.0, 60 / max(n, 1))))
        w = join(objs, name)
        w.data.transform(Matrix.Translation(-hub))
        w.location = hub
        finish_shading(w, 50)
        wheels[name] = w
    body_budget = args.budget - sum(tri_count(w) for w in wheels.values())
    # Visible exterior surfaces get more of the budget than the interior.
    weights = [IMPORTANCE.get(main_material(o), 1.0) for o in body_objs]
    counts = [tri_count(o) for o in body_objs]
    r = budget_ratio([n * w for n, w in zip(counts, weights)], body_budget, 120)
    print(f"body: {len(body_objs)} parts, {sum(counts)} tris -> ratio {r:.3f} (budget {body_budget})")
    for o, n, w in zip(body_objs, counts, weights):
        decimate(o, max(r * w, min(1.0, 120 / max(n, 1))))
    body = join(body_objs, "body")
    finish_shading(body, 50)

    for name, o in [("body", body), *wheels.items()]:
        print(f"{name:10s} tris {tri_count(o):7d}  loc {tuple(round(v, 3) for v in o.location)}")
    print("TOTAL tris", tri_count(body) + sum(tri_count(w) for w in wheels.values()))

    bpy.ops.export_scene.gltf(
        filepath=args.out,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_texcoords=False,
        export_normals=True,
        export_materials="EXPORT",
        export_animations=False,
        export_extras=False,
        use_visible=False,
    )
    print("wrote", args.out)


if __name__ == "__main__":
    main()
