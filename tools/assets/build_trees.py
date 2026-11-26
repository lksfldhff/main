#!/usr/bin/env python3
"""Game-ready street/park trees (LOD0/1/2) from Poly Haven CC0 photoscan trees.

Usage (needs Blender's Python module `bpy`, numpy, scipy, Pillow and gltf-transform from node_modules):

  PYTHONPATH=<dir containing bpy> python3 tools/assets/build_trees.py                 # all TREES
  PYTHONPATH=<dir containing bpy> python3 tools/assets/build_trees.py tree_street_young --preview /tmp/trees

Ids may be output ids (TREES keys) or Poly Haven ids. Raw downloads go to .assets-raw/trees/<polyhaven id>/.

Per tree:
  * trunk + twigs → one mesh, quadric-decimated in Blender (tiny twig tubes collapse away first)
  * leaves: every modelled leaf / leaf spray (15-170 tris) becomes ONE alpha-tested quad: an affine
    UV→3D fit of the leaf, spanning its UV box, so the texture (diffuse + Poly Haven's leaf alpha map)
    draws the leaf outline. Leaves are thinned to a random subset and every kept card is scaled by
    1/sqrt(keep) about its centre, so the canopy keeps its volume and covered area.
  * lod2: 3 crossed vertical + 1 horizontal billboard (16 tris, both sides modelled, single-sided
    material) with a canopy atlas rendered from the original model (Cycles, ambient light).
  * glTF is written directly (alphaMode MASK, doubleSided), then gltf-transform webp + meshopt.
Prints one library.json entry per tree; library.json itself is not modified here.
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import struct
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / ".assets-raw" / "trees"
OUT = ROOT / "public" / "assets" / "models"
UA = {"User-Agent": "heilbronn-game-asset-fetcher/1.0"}
DOWNLOADED = "2026-11-26"

# bark / twigs = triangle budgets (bark_part: smallest bark piece kept, m), cards = kept leaf cards (2 tris each), *_tex = texture edge lengths
TREES = {
    "tree_street_young": dict(
        src="tree_small_02",
        lod0=dict(bark=4000, bark_part=0.1, twigs=3000, cards=6000, leaf_tex=1024, leaf_nrm=512, bark_tex=1024, bark_nrm=512, twig_tex=512),
        lod1=dict(bark=500, bark_part=0.4, twigs=300, cards=800, clusters=600, leaf_tex=512, leaf_nrm=0, bark_tex=512, bark_nrm=0, twig_tex=256),
    ),
    "tree_park_old": dict(
        src="island_tree_01",
        lod0=dict(bark=4000, bark_part=0.1, twigs=3000, cards=6000, leaf_tex=1024, leaf_nrm=512, bark_tex=1024, bark_nrm=512, twig_tex=512),
        lod1=dict(bark=500, bark_part=0.4, twigs=300, cards=800, clusters=600, leaf_tex=512, leaf_nrm=0, bark_tex=512, bark_nrm=0, twig_tex=256),
    ),
}
LOD2_RENDER = 512  # bake resolution per view
LOD2_TILE = 256  # atlas tile (2x2 tiles)
SEED = 7


# --------------------------------------------------------------------------- download / info
def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r:
        return r.read()


def polyhaven_info(sid: str) -> dict:
    d = json.loads(get(f"https://api.polyhaven.com/info/{sid}"))
    return {"title": d.get("name", sid), "author": ", ".join(d.get("authors", {}).keys()), "url": f"https://polyhaven.com/a/{sid}"}


def download(sid: str) -> Path:
    dest = RAW / sid
    files = json.loads(get(f"https://api.polyhaven.com/files/{sid}"))
    g = files["gltf"]["1k"]["gltf"]
    items = [(f"{sid}.gltf", g["url"])] + [(rel, m["url"]) for rel, m in g.get("include", {}).items()]
    alpha = files.get("leaves_alpha", {}).get("1k", {}).get("png")
    if alpha:  # the glTF ships the leaf diffuse as JPEG without its alpha channel
        items.append((f"textures/{sid}_leaves_alpha_1k.png", alpha["url"]))
    for rel, url in items:
        p = dest / rel
        if not p.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(get(url))
    return dest / f"{sid}.gltf"


# --------------------------------------------------------------------------- glTF read
def read_gltf(path: Path):
    d = json.loads(path.read_text())
    bufs = [(path.parent / b["uri"]).read_bytes() for b in d["buffers"]]

    def acc(i):
        a = d["accessors"][i]
        bv = d["bufferViews"][a["bufferView"]]
        dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a["componentType"]]
        n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
        x = np.frombuffer(bufs[bv["buffer"]], dt, a["count"] * n, bv.get("byteOffset", 0) + a.get("byteOffset", 0))
        assert "byteStride" not in bv or bv["byteStride"] == x.itemsize * n
        return x.reshape(a["count"], n).astype(np.float64) if n > 1 else x.astype(np.int64)

    prims = []
    for node in d["nodes"]:
        if "mesh" not in node:
            continue
        assert not any(k in node for k in ("matrix", "rotation", "scale", "translation")), "node transforms not supported"
        for pr in d["meshes"][node["mesh"]]["primitives"]:
            at = pr["attributes"]
            prims.append(dict(
                mat=pr["material"], F=acc(pr["indices"]).reshape(-1, 3), V=acc(at["POSITION"]), N=acc(at["NORMAL"]),
                UV=[acc(at[k]) if k in at else None for k in ("TEXCOORD_0", "TEXCOORD_1")],
            ))
    return d, prims


def components(F: np.ndarray, n: int):
    r = np.concatenate([F[:, 0], F[:, 1]])
    c = np.concatenate([F[:, 1], F[:, 2]])
    return connected_components(coo_matrix((np.ones(len(r)), (r, c)), shape=(n, n)), directed=False)


def role(mat: dict) -> str:
    name = mat["name"].lower()
    if "leaves" in name or "leaf" in name or mat.get("alphaMode") in ("BLEND", "MASK"):
        return "leaves"
    return "twigs" if "branch" in name else "bark"


def tex_coord(mat: dict) -> int:
    return mat.get("pbrMetallicRoughness", {}).get("baseColorTexture", {}).get("texCoord", 0)


# --------------------------------------------------------------------------- leaves → cards
def leaf_cards(F, V, N, UV):
    """One quad per connected leaf: affine fit P = [u v 1]·A over the leaf's vertices, evaluated at its UV box."""
    k, lab = components(F, len(V))
    X = np.c_[UV, np.ones(len(UV))]
    M = np.zeros((k, 3, 3))
    B = np.zeros((k, 3, 3))
    for i in range(3):
        for j in range(3):
            M[:, i, j] = np.bincount(lab, X[:, i] * X[:, j], minlength=k)
            B[:, i, j] = np.bincount(lab, X[:, i] * V[:, j], minlength=k)
    A = np.linalg.solve(M + np.eye(3) * 1e-12, B)
    lo = np.full((k, 2), np.inf)
    hi = np.full((k, 2), -np.inf)
    np.minimum.at(lo, lab, UV)
    np.maximum.at(hi, lab, UV)
    uv = np.stack([lo, np.c_[hi[:, 0], lo[:, 1]], hi, np.c_[lo[:, 0], hi[:, 1]]], 1)  # (k,4,2)
    P = np.einsum("kci,kij->kcj", np.concatenate([uv, np.ones((k, 4, 1))], 2), A)
    navg = np.stack([np.bincount(lab, N[:, c], minlength=k) for c in range(3)], 1)
    n = np.cross(P[:, 1] - P[:, 0], P[:, 3] - P[:, 0])
    flip = np.einsum("ki,ki->k", n, navg) < 0
    n[flip] *= -1
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    # keep winding consistent with the normal (three.js flips normals on back faces)
    P[flip] = P[flip][:, ::-1]
    uv[flip] = uv[flip][:, ::-1]
    ok = np.isfinite(P).all((1, 2)) & (np.linalg.norm(P[:, 2] - P[:, 0], axis=1) < 1.0)
    return P[ok], uv[ok], n[ok]


def thin_cards(P, uv, n, keep: int, rng):
    k = len(P)
    sel = np.sort(rng.choice(k, size=min(keep, k), replace=False))
    s = math.sqrt(k / len(sel))
    c = P[sel].mean(1, keepdims=True)
    Q = c + (P[sel] - c) * s
    F = (np.arange(len(sel))[:, None] * 4 + np.array([[0, 1, 2, 0, 2, 3]])).reshape(-1, 3)
    return dict(pos=Q.reshape(-1, 3), nrm=np.repeat(n[sel], 4, 0), uv=uv[sel].reshape(-1, 2), idx=F)


def leaf_texture(diff: Path, alpha: Path | None, F_uv_tris: np.ndarray, size: int) -> Image.Image:
    """RGBA leaf atlas: diffuse + alpha map, gated by the UV outline of the modelled leaves, colour-bled."""
    rgb = np.asarray(Image.open(diff).convert("RGB")).astype(np.float32)
    H, W = rgb.shape[:2]
    a = np.asarray(Image.open(alpha)).astype(np.float32) if alpha and alpha.exists() else np.full((H, W), 1.0)
    if a.ndim == 3:
        a = a[..., 0]
    a = a / (65535.0 if a.max() > 255 else 255.0)
    if a.shape != (H, W):
        a = np.asarray(Image.fromarray(a).resize((W, H)))
    cov = Image.new("L", (W, H), 0)
    dr = ImageDraw.Draw(cov)
    for t in F_uv_tris:
        dr.polygon([(float(u * W), float(v * H)) for u, v in t], fill=255)
    cov = ndimage.binary_dilation(np.asarray(cov) > 0, iterations=4)
    alpha_f = np.clip(a, 0, 1) * cov
    solid = alpha_f > 0.5
    _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
    rgb = rgb[iy, ix]
    img = Image.fromarray(np.dstack([rgb, alpha_f * 255]).clip(0, 255).astype(np.uint8), "RGBA")
    return img.resize((size, size), Image.LANCZOS) if size != W else img


def finish_atlas(atlas: Image.Image, lo: float = 0.1, hi: float = 0.4, tint: float = 1.0) -> Image.Image:
    """Baked foliage atlases: thin, anti-aliased leaves would vanish under an alpha cutoff of 0.5 → remap alpha
    (lo..hi → 0..1) to keep the canopy's coverage, then bleed colour into transparent texels (mip-maps)."""
    a = np.asarray(atlas.convert("RGBA")).astype(np.float32)
    a[..., 3] = np.clip((a[..., 3] / 255 - lo) / (hi - lo), 0, 1) * 255
    solid = a[..., 3] > 127
    _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
    a[..., :3] = a[iy, ix, :3] * tint
    return Image.fromarray(a.clip(0, 255).astype(np.uint8), "RGBA")


# --------------------------------------------------------------------------- leaf clusters (mid LOD)
def _ambient_cycles(sc, samples: int):
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 3
    sc.cycles.transparent_max_bounces = 64
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    w = bpy_mod().data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (1, 1, 1, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 1.0


def bpy_mod():
    import bpy

    return bpy


def cluster_cards(P, uv, n, K: int, atlas_px: int, leaf_png: Path, tmp: Path, rng, grid: int = 4):
    """Groups the leaf cards into K spatial clusters; each becomes one card (PCA plane, outward facing).
    grid x grid representative clusters are rendered from the full-density cards (ambient light → baked AO)
    into an atlas tile; every cluster card uses a random tile."""
    import bpy
    import mathutils
    from scipy.cluster.vq import kmeans2

    ctr = P.mean(1)
    _, lab = kmeans2(ctr, K, seed=SEED, minit="++")
    crown = ctr.mean(0)
    frames = []
    for j in range(K):
        sel = np.nonzero(lab == j)[0]
        if len(sel) == 0:
            continue
        pts = P[sel].reshape(-1, 3)
        c = ctr[sel].mean(0)
        _, _, vt = np.linalg.svd(pts - c, full_matrices=False)
        e1, e2 = vt[0], vt[1]
        e3 = np.cross(e1, e2)
        if np.dot(e3, c - crown) < 0:  # face outwards
            e2, e3 = -e2, -e3
        pr = (pts - c) @ np.stack([e1, e2]).T
        a, b = np.percentile(np.abs(pr), 97, axis=0) + 1e-3
        frames.append((sel, c, e1, e2, e3, a, b))
    counts = np.array([len(f[0]) for f in frames])
    mid = np.nonzero((counts >= np.percentile(counts, 30)) & (counts <= np.percentile(counts, 85)))[0]
    reps = rng.choice(mid, size=min(grid * grid, len(mid)), replace=False)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    _ambient_cycles(sc, 32)
    img = bpy.data.images.load(str(leaf_png))
    mat = bpy.data.materials.new("leaf")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tx = nt.nodes.new("ShaderNodeTexImage")
    tx.image = img
    nt.links.new(tx.outputs["Color"], bsdf.inputs["Base Color"])
    rnd = nt.nodes.new("ShaderNodeMath")
    rnd.operation = "GREATER_THAN"
    rnd.inputs[1].default_value = 0.5
    nt.links.new(tx.outputs["Alpha"], rnd.inputs[0])
    nt.links.new(rnd.outputs[0], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.8
    bsdf.inputs["Specular IOR Level"].default_value = 0.0  # bake albedo x ambient occlusion, no sheen
    cam = bpy.data.cameras.new("c")
    cam.type = "ORTHO"
    co = bpy.data.objects.new("c", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    tile = atlas_px // grid
    atlas = Image.new("RGBA", (atlas_px, atlas_px))
    for t, r in enumerate(reps):
        sel, c, e1, e2, e3, a, b = frames[r]
        near = sel
        q = P[near]
        me = bpy.data.meshes.new("cl")
        me.from_pydata(q.reshape(-1, 3).tolist(), [], (np.arange(len(near) * 4).reshape(-1, 4)).tolist())
        uvl = me.uv_layers.new(name="uv")
        uvl.data.foreach_set("uv", np.c_[uv[near][..., 0].ravel(), 1 - uv[near][..., 1].ravel()].astype(np.float32).ravel())
        me.materials.append(mat)
        ob = bpy.data.objects.new("cl", me)
        sc.collection.objects.link(ob)
        rot = mathutils.Matrix(np.stack([e1, e2, e3], 1).tolist()).to_quaternion()
        co.rotation_mode = "QUATERNION"
        co.rotation_quaternion = rot
        co.location = mathutils.Vector((c + e3 * 20).tolist())
        cam.clip_end = 100
        m = max(a, b)
        cam.ortho_scale = 2 * m
        sc.render.resolution_x = max(8, round(tile * 2 * a / m))
        sc.render.resolution_y = max(8, round(tile * 2 * b / m))
        sc.render.resolution_percentage = 200
        sc.render.filepath = str(tmp / f"cl{t}.png")
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(ob)
        bpy.data.meshes.remove(me)
        im = Image.open(tmp / f"cl{t}.png").convert("RGBA").resize((tile, tile), Image.LANCZOS)
        atlas.paste(im, ((t % grid) * tile, (t // grid) * tile))
    atlas = finish_atlas(atlas, tint=0.9)

    pos, nrm, uvs = [], [], []
    ntile = len(reps)
    for sel, c, e1, e2, e3, a, b in frames:
        t = rng.integers(ntile)
        u0, v0 = (t % grid) / grid, (t // grid) / grid
        g = 1 / grid
        pos.append([c - e1 * a - e2 * b, c + e1 * a - e2 * b, c + e1 * a + e2 * b, c - e1 * a + e2 * b])
        uvs.append([[u0, v0 + g], [u0 + g, v0 + g], [u0 + g, v0], [u0, v0]])
        nrm.append([e3] * 4)
    pos = np.array(pos)
    k = len(pos)
    F = (np.arange(k)[:, None] * 4 + np.array([[0, 1, 2, 0, 2, 3]])).reshape(-1, 3)
    return dict(pos=pos.reshape(-1, 3), nrm=np.array(nrm).reshape(-1, 3), uv=np.array(uvs).reshape(-1, 2), idx=F), atlas


# --------------------------------------------------------------------------- wood decimation (Blender)
TWIG_FLOOR = 18  # a decimated twig tube keeps roughly this many triangles


def pick_parts(F, V, min_diag: float, max_parts: int | None = None):
    """Keeps disconnected pieces (bark bits, twigs) of at least min_diag metres, largest first (always the largest)."""
    k, lab = components(F, len(V))
    lo = np.full((k, 3), np.inf)
    hi = np.full((k, 3), -np.inf)
    np.minimum.at(lo, lab, V)
    np.maximum.at(hi, lab, V)
    diag = np.linalg.norm(hi - lo, axis=1)
    order = np.argsort(-diag)
    order = order[: max(1, (diag >= min_diag).sum())]
    if max_parts is not None:
        order = order[: max(1, max_parts)]
    keep = np.zeros(k, bool)
    keep[order] = True
    return F[keep[lab[F[:, 0]]]]


def decimate(parts, target: int):
    """parts: list of (F, V, N, UV, slot). Returns {slot: prim} decimated together to ~target tris."""
    import bpy

    Fs, Vs, UVs, slots, off = [], [], [], [], 0
    for F, V, N, UV, slot in parts:
        Fs.append(F + off)
        Vs.append(V)
        UVs.append(UV[F].reshape(-1, 2))
        slots.append(np.full(len(F), slot))
        off += len(V)
    F, V, UVc, S = np.concatenate(Fs), np.concatenate(Vs), np.concatenate(UVs), np.concatenate(slots)
    key = np.round(V / 1e-5).astype(np.int64)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.ravel()
    Vw = np.zeros((len(uniq), 3))
    Vw[inv] = V
    Fw = inv[F]
    good = (Fw[:, 0] != Fw[:, 1]) & (Fw[:, 1] != Fw[:, 2]) & (Fw[:, 0] != Fw[:, 2])
    Fw, S, UVc = Fw[good], S[good], UVc.reshape(-1, 3, 2)[good].reshape(-1, 2)

    me = bpy.data.meshes.new("wood")
    me.vertices.add(len(Vw))
    me.vertices.foreach_set("co", Vw.astype(np.float32).ravel())
    me.loops.add(Fw.size)
    me.loops.foreach_set("vertex_index", Fw.ravel().astype(np.int32))
    me.polygons.add(len(Fw))
    me.polygons.foreach_set("loop_start", (np.arange(len(Fw)) * 3).astype(np.int32))
    me.polygons.foreach_set("material_index", S.astype(np.int32))
    uvl = me.uv_layers.new(name="uv")
    uvl.data.foreach_set("uv", UVc.astype(np.float32).ravel())
    me.update(calc_edges=True)
    me.validate()
    me.shade_smooth()
    ob = bpy.data.objects.new("wood", me)
    bpy.context.scene.collection.objects.link(ob)
    # protect the trunk foot so the decimated tree still stands on y=0
    vg = ob.vertex_groups.new(name="foot")
    vg.add([int(i) for i in np.nonzero(Vw[:, 1] < Vw[:, 1].min() + 0.03)[0]], 1.0, "REPLACE")
    mod = ob.modifiers.new("dec", "DECIMATE")
    mod.vertex_group = "foot"
    mod.invert_vertex_group = True  # weight 0 (after inversion) = preserved
    mod.vertex_group_factor = 10.0
    mod.ratio = min(1.0, target / max(len(Fw), 1))
    mod.use_collapse_triangulate = True
    for it in range(6):  # disconnected pieces / the protected foot keep the modifier above target: iterate
        dg = bpy.context.evaluated_depsgraph_get()
        m2 = ob.evaluated_get(dg).to_mesh()
        m2.calc_loop_triangles()
        got = len(m2.loop_triangles)
        if got <= target * 1.05 or it == 5:
            break
        ob.to_mesh_clear()
        mod.ratio *= 0.95 * target / got
        bpy.context.view_layer.update()
    nt = len(m2.loop_triangles)
    tl = np.empty(nt * 3, np.int32)
    m2.loop_triangles.foreach_get("loops", tl)
    tp = np.empty(nt, np.int32)
    m2.loop_triangles.foreach_get("polygon_index", tp)
    lv = np.empty(len(m2.loops), np.int32)
    m2.loops.foreach_get("vertex_index", lv)
    co = np.empty(len(m2.vertices) * 3, np.float32)
    m2.vertices.foreach_get("co", co)
    uv = np.empty(len(m2.loops) * 2, np.float32)
    m2.uv_layers["uv"].data.foreach_get("uv", uv)
    cn = np.empty(len(m2.loops) * 3, np.float32)
    m2.corner_normals.foreach_get("vector", cn)
    pm = np.empty(len(m2.polygons), np.int32)
    m2.polygons.foreach_get("material_index", pm)
    co, uv, cn = co.reshape(-1, 3), uv.reshape(-1, 2), cn.reshape(-1, 3)
    out = {}
    for slot in np.unique(pm[tp]):
        loops = tl.reshape(-1, 3)[pm[tp] == slot].ravel()
        attr = np.c_[co[lv[loops]], cn[loops], uv[loops]]
        u, inv2 = np.unique(np.round(attr, 6), axis=0, return_inverse=True)
        out[int(slot)] = dict(pos=u[:, :3], nrm=u[:, 3:6], uv=u[:, 6:8], idx=inv2.reshape(-1, 3))
    ob.to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return out


# --------------------------------------------------------------------------- glTF write
class GltfWriter:
    def __init__(self):
        self.d = {"asset": {"version": "2.0", "generator": "heilbronn build_trees.py"}, "scene": 0, "scenes": [{"nodes": [0]}],
                  "nodes": [{"mesh": 0, "name": "tree"}], "meshes": [{"primitives": []}], "materials": [], "textures": [],
                  "images": [], "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
                  "accessors": [], "bufferViews": [], "buffers": []}
        self.bin = bytearray()
        self.files: dict[str, Image.Image] = {}
        self.ext: set[str] = set()

    def _acc(self, arr, comp, typ, target, minmax=False):
        data = arr.astype(np.uint32 if comp == 5125 else np.float32).tobytes()
        while len(self.bin) % 4:
            self.bin.append(0)
        self.d["bufferViews"].append({"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data), "target": target})
        self.bin += data
        a = {"bufferView": len(self.d["bufferViews"]) - 1, "componentType": comp, "count": len(arr), "type": typ}
        if minmax:
            a["min"], a["max"] = arr.min(0).tolist(), arr.max(0).tolist()
        self.d["accessors"].append(a)
        return len(self.d["accessors"]) - 1

    def image(self, name: str, img: Image.Image) -> int:
        self.files[name] = img
        self.d["images"].append({"uri": name})
        self.d["textures"].append({"source": len(self.d["images"]) - 1, "sampler": 0})
        return len(self.d["textures"]) - 1

    def material(self, m: dict) -> int:
        self.d["materials"].append(m)
        return len(self.d["materials"]) - 1

    def prim(self, p: dict, mat: int):
        n = p["nrm"] / (np.linalg.norm(p["nrm"], axis=1, keepdims=True) + 1e-12)
        self.d["meshes"][0]["primitives"].append({
            "attributes": {"POSITION": self._acc(p["pos"], 5126, "VEC3", 34962, True), "NORMAL": self._acc(n, 5126, "VEC3", 34962),
                           "TEXCOORD_0": self._acc(p["uv"], 5126, "VEC2", 34962)},
            "indices": self._acc(p["idx"].ravel(), 5125, "SCALAR", 34963), "material": mat})

    def write(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        for name, img in self.files.items():
            img.save(path.parent / name)
        (path.parent / "data.bin").write_bytes(bytes(self.bin))
        self.d["buffers"] = [{"uri": "data.bin", "byteLength": len(self.bin)}]
        if self.ext:
            self.d["extensionsUsed"] = sorted(self.ext)
        path.write_text(json.dumps(self.d))


def tex_info(src_info: dict | None, tex: int, writer: GltfWriter) -> dict:
    t = {"index": tex}
    ext = (src_info or {}).get("extensions", {})
    if "KHR_texture_transform" in ext:
        tt = {k: v for k, v in ext["KHR_texture_transform"].items() if k != "texCoord"}
        t["extensions"] = {"KHR_texture_transform": tt}
        writer.ext.add("KHR_texture_transform")
    if src_info and "scale" in src_info:
        t["scale"] = src_info["scale"]
    return t


def src_image(gltf: dict, base: Path, info: dict | None) -> Path | None:
    if not info:
        return None
    return base / gltf["images"][gltf["textures"][info["index"]]["source"]]["uri"]


def load_img(p: Path, size: int, mode="RGB") -> Image.Image:
    im = Image.open(p).convert(mode)
    return im.resize((size, size), Image.LANCZOS) if im.size != (size, size) else im


def gltf_transform(*args: str):
    subprocess.run(["npx", "--no-install", "gltf-transform", *args], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)


def glb_stats(glb: Path) -> dict:
    out = subprocess.run(["node", str(ROOT / "tools/assets/stats.mjs"), str(glb)], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return json.loads(out)


DECODE_JS = """
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[1]);
for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'EXT_meshopt_compression') e.dispose();
await io.write(process.argv[2], doc);
"""


def decode_meshopt(src: Path, dst: Path):
    """Blender's importer lacks the meshopt decoder library → strip EXT_meshopt_compression for previews."""
    subprocess.run(["node", "--input-type=module", "-e", DECODE_JS, str(src), str(dst)], cwd=ROOT, check=True)


def finish(writer: GltfWriter, tmp: Path, target: Path):
    gl = tmp / "model.gltf"
    writer.write(gl)
    mid = tmp / "webp.glb"
    gltf_transform("webp", str(gl), str(mid), "--quality", "85")
    target.parent.mkdir(parents=True, exist_ok=True)
    gltf_transform("meshopt", str(mid), str(target), "--level", "medium")


# --------------------------------------------------------------------------- LOD2 billboards
def bake_billboards(gltf_path: Path, shift: np.ndarray, tmp: Path):
    """Renders the original tree (Cycles, ambient light, transparent) from 3 sides + top → RGBA tiles."""
    import bpy
    import mathutils

    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=str(gltf_path))
    objs = [o for o in sc.objects if o.type == "MESH"]
    for m in bpy.data.materials:  # bake albedo x ambient occlusion, no specular sheen
        for n in (m.node_tree.nodes if m.node_tree else []):
            if n.type == "BSDF_PRINCIPLED":
                n.inputs["Specular IOR Level"].default_value = 0.0
    for o in sc.objects:
        if o.parent is None:  # glTF (x,y,z) → Blender (x,-z,y)
            o.location += mathutils.Vector((shift[0], -shift[2], shift[1]))
    bpy.context.view_layer.update()
    pts = np.concatenate([np.array([o.matrix_world @ v.co for v in o.data.vertices]) for o in objs])
    zmin, zmax = 0.0, pts[:, 2].max()
    axis = (pts[:, :2].min(0) + pts[:, :2].max(0)) / 2
    R = np.linalg.norm(pts[:, :2] - axis, axis=1).max() * 1.02
    leafz = pts[:, 2]
    canopy_lo = np.percentile(leafz, 30)
    cam = bpy.data.cameras.new("c")
    cam.type = "ORTHO"
    co = bpy.data.objects.new("c", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 48
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 3
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (1, 1, 1, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    H = zmax - zmin
    views = []
    for i, th in enumerate((0.0, 60.0, 120.0)):
        t = math.radians(th)
        h = np.array([math.cos(t), math.sin(t)])  # in-plane horizontal axis (Blender xy)
        nrm = np.array([-h[1], h[0]])
        # camera on the -nrm side looking along +nrm, so image right = +h (matches the quad's UVs)
        co.location = (axis[0] - nrm[0] * 50, axis[1] - nrm[1] * 50, zmin + H / 2)
        co.rotation_euler = mathutils.Vector((nrm[0], nrm[1], 0)).to_track_quat("-Z", "Y").to_euler()
        cam.ortho_scale = max(2 * R, H)
        sc.render.resolution_x = LOD2_RENDER if 2 * R >= H else max(8, round(LOD2_RENDER * 2 * R / H))
        sc.render.resolution_y = LOD2_RENDER if H >= 2 * R else max(8, round(LOD2_RENDER * H / (2 * R)))
        sc.render.filepath = str(tmp / f"bb{i}.png")
        bpy.ops.render.render(write_still=True)
        views.append(("v", h, tmp / f"bb{i}.png"))
    co.location = (axis[0], axis[1], zmax + 50)
    co.rotation_euler = (0, 0, 0)
    cam.ortho_scale = 2 * R
    sc.render.resolution_x = sc.render.resolution_y = LOD2_RENDER
    sc.render.filepath = str(tmp / "bb_top.png")
    bpy.ops.render.render(write_still=True)
    views.append(("h", None, tmp / "bb_top.png"))
    # glTF coords: Blender (x,y,z) → (x, z, -y)
    return views, np.array([axis[0], -axis[1]]), R, H, (canopy_lo + zmax) / 2


def billboard_lod(views, axis, R, H, top_y):
    tiles = []
    for _, _, p in views:
        im = Image.open(p).convert("RGBA").resize((LOD2_TILE, LOD2_TILE), Image.LANCZOS)
        tiles.append(im)
    atlas = Image.new("RGBA", (LOD2_TILE * 2, LOD2_TILE * 2))
    for i, im in enumerate(tiles):
        atlas.paste(im, ((i % 2) * LOD2_TILE, (i // 2) * LOD2_TILE))
    atlas = finish_atlas(atlas)
    pos, uv, idx, nrm = [], [], [], []
    for i, (kind, h, _) in enumerate(views):
        u0, v0 = (i % 2) * 0.5, (i // 2) * 0.5
        quv = np.array([[u0, v0 + 0.5], [u0 + 0.5, v0 + 0.5], [u0 + 0.5, v0], [u0, v0]])
        if kind == "v":
            hx = np.array([h[0], 0.0, -h[1]])  # Blender xy dir → glTF xz
            c = np.array([axis[0], 0.0, axis[1]])
            hw, ht, y0 = R, H, 0.0  # tile was rendered for exactly 2R x H and stretched to a square
            q = np.array([c - hx * hw + [0, y0, 0], c + hx * hw + [0, y0, 0], c + hx * hw + [0, y0 + ht, 0], c - hx * hw + [0, y0 + ht, 0]])
        else:
            c = np.array([axis[0], top_y, axis[1]])
            # top view: image right = +x, image up = Blender +y = glTF -z
            q = np.array([c + [-R, 0, R], c + [R, 0, R], c + [R, 0, -R], c + [-R, 0, -R]])
        fn = np.cross(q[1] - q[0], q[3] - q[0])
        fn /= np.linalg.norm(fn)
        for quad, sgn in ((q, 1.0), (q[::-1], -1.0)):  # both sides as separate faces
            b = len(pos) * 4
            pos.append(quad)
            nn = fn * sgn + np.array([0.0, 1.5, 0.0])  # tilted up: even canopy lighting, sunny side brighter
            nrm.append(np.tile(nn / np.linalg.norm(nn), (4, 1)))
            uv.append(quv if quad is q else quv[::-1])
            idx.append(np.array([[b, b + 1, b + 2], [b, b + 2, b + 3]]))
    return dict(pos=np.concatenate(pos), nrm=np.concatenate(nrm), uv=np.concatenate(uv), idx=np.concatenate(idx)), atlas


# --------------------------------------------------------------------------- build one tree
def build(tree_id: str, cfg: dict, preview: Path | None, do_lod2: bool) -> dict:
    sid = cfg["src"]
    info = polyhaven_info(sid)
    path = download(sid)
    gltf, prims = read_gltf(path)
    mats = gltf["materials"]
    rng = np.random.default_rng(SEED)

    by_role: dict[str, list] = {"bark": [], "twigs": [], "leaves": []}
    for p in prims:
        m = mats[p["mat"]]
        r = role(m)
        uv = p["UV"][tex_coord(m)]
        by_role[r].append((p["F"], p["V"], p["N"], uv, m))
    # origin: centre of the trunk's lowest 30 cm, ground at y=0
    bv = np.concatenate([v for _, v, *_ in by_role["bark"]])
    y0 = bv[:, 1].min()
    foot = bv[bv[:, 1] < y0 + 0.3]
    cx, cz = (foot[:, [0, 2]].min(0) + foot[:, [0, 2]].max(0)) / 2
    shift = np.array([-cx, -y0, -cz])
    for r in by_role:
        by_role[r] = [(F, V + shift, N, UV, m) for F, V, N, UV, m in by_role[r]]

    F, V, N, UV, leaf_mat = by_role["leaves"][0]
    P, cuv, cn = leaf_cards(F, V, N, UV)
    uv_tris = np.unique(np.round(UV[F], 4).reshape(-1, 6), axis=0).reshape(-1, 3, 2)
    leaf_diff = src_image(gltf, path.parent, leaf_mat["pbrMetallicRoughness"]["baseColorTexture"])
    leaf_alpha = path.parent / "textures" / f"{sid}_leaves_alpha_1k.png"
    leaf_rgba = leaf_texture(leaf_diff, leaf_alpha, uv_tris, 1024)
    print(f"  {sid}: {len(P)} leaf cards (from {len(F)} leaf tris)")

    out = OUT / tree_id
    lods = {}
    for lod in ("lod0", "lod1"):
        c = cfg[lod]
        w = GltfWriter()
        wood_mats = [m for *_, m in by_role["bark"] + by_role["twigs"]]
        dec = {}
        nb = len(by_role["bark"])
        bark = [(pick_parts(F_, V_, c["bark_part"]), V_, N_, UV_, i) for i, (F_, V_, N_, UV_, _) in enumerate(by_role["bark"])]
        dec.update(decimate(bark, c["bark"]))
        if by_role["twigs"] and c["twigs"]:
            twigs = [(pick_parts(F_, V_, 0.0, c["twigs"] // TWIG_FLOOR), V_, N_, UV_, nb + i) for i, (F_, V_, N_, UV_, _) in enumerate(by_role["twigs"])]
            dec.update(decimate(twigs, c["twigs"]))
        for slot, prim in sorted(dec.items()):
            m = wood_mats[slot]
            pbr = m["pbrMetallicRoughness"]
            is_twig = role(m) == "twigs"
            size = c["twig_tex"] if is_twig else c["bark_tex"]
            base = w.image(f"{'twig' if is_twig else 'bark'}{slot}_diff.png", load_img(src_image(gltf, path.parent, pbr["baseColorTexture"]), size))
            mat = {"name": f"{tree_id}_{'twigs' if is_twig else 'bark'}", "doubleSided": False,
                   "pbrMetallicRoughness": {"baseColorTexture": tex_info(pbr["baseColorTexture"], base, w), "metallicFactor": 0.0, "roughnessFactor": 0.9}}
            nsz = 0 if is_twig else c["bark_nrm"]
            if nsz and "normalTexture" in m:
                nt = w.image(f"bark{slot}_nrm.png", load_img(src_image(gltf, path.parent, m["normalTexture"]), nsz))
                mat["normalTexture"] = tex_info(m["normalTexture"], nt, w)
            w.prim(prim, w.material(mat))
        if c.get("clusters"):
            with tempfile.TemporaryDirectory() as td:
                leaf_png = Path(td) / "leaf.png"
                leaf_rgba.save(leaf_png)
                leaves, catlas = cluster_cards(P, cuv, cn, c["clusters"], c["leaf_tex"], leaf_png, Path(td), rng)
            if preview:
                catlas.save(preview / f"{tree_id}_{lod}_cluster_atlas.png")
            lt = w.image("leaves_diff.png", catlas)
        else:
            leaves = thin_cards(P, cuv, cn, c["cards"], rng)
            lt = w.image("leaves_diff.png", leaf_rgba.resize((c["leaf_tex"],) * 2, Image.LANCZOS) if c["leaf_tex"] != 1024 else leaf_rgba)
        lm = {"name": f"{tree_id}_leaves", "alphaMode": "MASK", "alphaCutoff": 0.5, "doubleSided": True,
              "pbrMetallicRoughness": {"baseColorTexture": {"index": lt}, "metallicFactor": 0.0, "roughnessFactor": 0.8}}
        if c["leaf_nrm"] and "normalTexture" in leaf_mat and not c.get("clusters"):
            nt = w.image("leaves_nrm.png", load_img(src_image(gltf, path.parent, leaf_mat["normalTexture"]), c["leaf_nrm"]))
            lm["normalTexture"] = {"index": nt}
        w.prim(leaves, w.material(lm))
        with tempfile.TemporaryDirectory() as td:
            finish(w, Path(td), out / f"{lod}.glb")
        lods[lod] = out / f"{lod}.glb"

    if do_lod2:
        with tempfile.TemporaryDirectory() as td:
            views, axis, R, H, top_y = bake_billboards(path, shift, Path(td))
            prim, atlas = billboard_lod(views, axis, R, H, top_y)
            w = GltfWriter()
            t = w.image("billboard.png", atlas)
            m = w.material({"name": f"{tree_id}_billboard", "alphaMode": "MASK", "alphaCutoff": 0.5, "doubleSided": False,
                            "pbrMetallicRoughness": {"baseColorTexture": {"index": t}, "metallicFactor": 0.0, "roughnessFactor": 1.0}})
            w.prim(prim, m)
            finish(w, Path(td) / "w", out / "lod2.glb")
            lods["lod2"] = out / "lod2.glb"

    entry_lods = {}
    for lod, f in lods.items():
        st = glb_stats(f)
        entry_lods[lod] = {"file": f"models/{tree_id}/{lod}.glb", "bytes": f.stat().st_size, "triangles": st["triangles"], "bounds": st["bounds"]}
    height = round(entry_lods["lod0"]["bounds"][1][1] - entry_lods["lod0"]["bounds"][0][1], 2)
    entry = {"id": tree_id, "category": "vegetation/tree", "title": info["title"], "source": "polyhaven", "sourceUrl": info["url"],
             "author": info["author"], "license": "CC0", "attribution": f"{info['title']} by {info['author']} ({info['url']}), CC0",
             "downloaded": DOWNLOADED, "targetHeight": height, "lodDistances": [0, 45], "lods": entry_lods}
    if preview:
        with tempfile.TemporaryDirectory() as td:
            dec = []
            for lod, f in lods.items():
                dec.append(Path(td) / f"{lod}.glb")
                decode_meshopt(f, dec[-1])
            render_preview([path] + dec, preview / f"{tree_id}_front.png", shift)
            render_preview([path] + dec, preview / f"{tree_id}_side.png", shift, yaw=90)
    return entry


# --------------------------------------------------------------------------- preview renders
def render_preview(files, out_png: Path, shift, yaw=0.0, height_px=512, samples=16):
    """Side-by-side Cycles render (original first, then LODs), orthographic, slight elevation."""
    import bpy
    import mathutils

    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    groups = []
    for i, f in enumerate(files):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(f))
        g = [o for o in bpy.data.objects if o not in before]
        for o in g:
            if o.parent is None:
                if i == 0:
                    o.location += mathutils.Vector((shift[0], -shift[2], shift[1]))
                o.rotation_mode = "XYZ"
                o.rotation_euler.z += math.radians(yaw)
        groups.append(g)
    bpy.context.view_layer.update()

    for mat in bpy.data.materials:  # Cycles ignores backface culling: hide back faces of single-sided materials
        if not (mat.use_backface_culling and mat.node_tree):
            continue
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        inv = nt.nodes.new("ShaderNodeMath")
        inv.operation = "SUBTRACT"
        inv.inputs[0].default_value = 1.0
        nt.links.new(geo.outputs["Backfacing"], inv.inputs[1])
        alpha = bsdf.inputs["Alpha"]
        if alpha.is_linked:
            mul = nt.nodes.new("ShaderNodeMath")
            mul.operation = "MULTIPLY"
            nt.links.new(alpha.links[0].from_socket, mul.inputs[0])
            nt.links.new(inv.outputs[0], mul.inputs[1])
            nt.links.new(mul.outputs[0], alpha)
        else:
            nt.links.new(inv.outputs[0], alpha)

    def bbox(objs):
        pts = [o.matrix_world @ mathutils.Vector(c) for o in objs if o.type == "MESH" for c in o.bound_box]
        return np.array(pts).min(0), np.array(pts).max(0)

    boxes = [bbox(g) for g in groups]
    W = max(max(b[1][0] - b[0][0], b[1][1] - b[0][1]) for b in boxes) * 1.05
    for i, g in enumerate(groups):
        for o in g:
            if o.parent is None:
                o.location.x += i * W
    bpy.context.view_layer.update()
    zmax = max(b[1][2] for b in boxes)
    bpy.ops.mesh.primitive_plane_add(size=500, location=((len(files) - 1) * W / 2, 0, 0))
    gm = bpy.data.materials.new("ground")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.3, 0.3, 0.28, 1)
    bpy.context.object.data.materials.append(gm)
    cam = bpy.data.cameras.new("c")
    cam.type = "ORTHO"
    co = bpy.data.objects.new("c", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    el = math.radians(10)
    co.location = ((len(files) - 1) * W / 2, -100 * math.cos(el), zmax * 0.5 + 100 * math.sin(el))
    co.rotation_euler = (math.pi / 2 - el, 0, 0)
    sc.render.resolution_y = height_px
    sc.render.resolution_x = int(height_px * len(files) * W / (zmax * 1.1))
    cam.ortho_scale = len(files) * W
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 4
    sc.cycles.transparent_max_bounces = 32
    sc.view_settings.view_transform = "Standard"
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.68, 0.85, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.7
    sun = bpy.data.lights.new("s", "SUN")
    sun.energy = 3.5
    so = bpy.data.objects.new("s", sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(45), 0, math.radians(35))
    out_png.parent.mkdir(parents=True, exist_ok=True)
    sc.render.filepath = str(out_png)
    sc.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    print(f"  preview → {out_png}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ids", nargs="*", help="tree ids (TREES keys) or Poly Haven ids; default: all")
    ap.add_argument("--preview", type=Path, help="render side-by-side previews (original | lod0 | lod1 | lod2) into this dir")
    ap.add_argument("--no-lod2", action="store_true", help="skip the billboard LOD")
    args = ap.parse_args()
    if not shutil.which("npx"):
        sys.exit("npx (Node.js) is required for gltf-transform")
    todo = [t for t in TREES if not args.ids or t in args.ids or TREES[t]["src"] in args.ids]
    entries = []
    for tid in todo:
        print(f"→ {tid} ({TREES[tid]['src']})")
        e = build(tid, TREES[tid], args.preview, not args.no_lod2)
        entries.append(e)
        for lod, v in e["lods"].items():
            print(f"  {lod}: {v['triangles']:>6} tris {v['bytes'] / 1e3:7.0f} kB")
    print(json.dumps({e["id"]: e for e in entries}, indent=1))


if __name__ == "__main__":
    main()
