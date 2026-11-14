"""
Canary Court mark: concept explorations (procedural, Blender 5.2).

Each concept is modelled as a handful of flat facets in Blender, projected through a camera
(orthographic or perspective) in Python, and written straight to SVG as flat polygons in one
ink with 2-3 tones per facet. No gradients, no strokes, no raster trace. Creases are thin
knock-out gaps: every facet, painted far to near, cuts a gap of `GAP` out of the facets
behind it (exact convex polygon subtraction), so the silhouette stays whole and there is no
outline.

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
      -P site/assets/blender/logo.py -- --out site/assets/blender/.render/logo

Writes, per concept X: X.paper.svg, X.night.svg, X.json (polygons + tones, 0..100 box, y down)
and X.blend. Previews and the contact sheet come from logo_sheet.py (Pillow).
"""

import argparse
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

INK = "#17171A"
PAPER = "#F6F5F1"
NIGHT = "#121214"
LIGHT_INK = "#EEEDE8"          # the reversed ink on night
CANARY = "#D2AE3C"
GAP = 0.016                    # crease gap, as a fraction of the mark's larger side
PAD = 0.06                     # padding inside the 100 x 100 viewBox


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="logo.py")
    p.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".render", "logo"))
    p.add_argument("--concepts", default="A,B,C")
    p.add_argument("--final", default="", help="write the picked mark's brand SVGs + JSON to this dir")
    return p.parse_args(argv)


def hexmix(a, b, t):
    ca = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    cb = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * t):02X}" for x, y in zip(ca, cb))


TONES = {
    "paper": [INK, hexmix(INK, PAPER, 0.40), hexmix(INK, PAPER, 0.66)],
    "night": [LIGHT_INK, hexmix(LIGHT_INK, NIGHT, 0.38), hexmix(LIGHT_INK, NIGHT, 0.62)],
}


# ----------------------------------------------------------------------------- 2D geometry
def area(poly):
    return 0.5 * sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1]
                     for i in range(len(poly)))


def ccw(poly):
    return poly if area(poly) >= 0 else poly[::-1]


def side(a, b, p):
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])


def clip_left(poly, a, b):
    """Sutherland-Hodgman: keep the part of poly on the left of the directed line a->b."""
    out = []
    n = len(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        sp, sq = side(a, b, p), side(a, b, q)
        if sp >= 0:
            out.append(p)
        if (sp >= 0) != (sq >= 0):
            t = sp / (sp - sq)
            out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    return out


def subtract(A, B):
    """Convex A minus convex B (both CCW) -> list of convex pieces."""
    pieces, rest = [], A
    for i in range(len(B)):
        a, b = B[i], B[(i + 1) % len(B)]
        outside = clip_left(rest, b, a)
        if len(outside) >= 3 and abs(area(outside)) > 1e-9:
            pieces.append(outside)
        rest = clip_left(rest, a, b)
        if len(rest) < 3:
            break
    return pieces


def expand(poly, d):
    """Offset a convex CCW polygon outward by d (bevelled where a mitre would spike)."""
    n = len(poly)
    out = []
    for i in range(n):
        p0, p1, p2 = poly[i - 1], poly[i], poly[(i + 1) % n]
        e0 = (p1[0] - p0[0], p1[1] - p0[1])
        e1 = (p2[0] - p1[0], p2[1] - p1[1])
        l0, l1 = math.hypot(*e0), math.hypot(*e1)
        n0 = (e0[1] / l0, -e0[0] / l0)          # outward normals for a CCW polygon
        n1 = (e1[1] / l1, -e1[0] / l1)
        cosang = max(-1.0, min(1.0, n0[0] * n1[0] + n0[1] * n1[1]))
        half = math.acos(cosang) / 2
        miter = d / max(math.cos(half), 1e-6)
        if miter > 2.0 * d:                     # sharp corner: bevel
            out.append((p1[0] + n0[0] * d, p1[1] + n0[1] * d))
            out.append((p1[0] + n1[0] * d, p1[1] + n1[1] * d))
        else:
            bx, by = n0[0] + n1[0], n0[1] + n1[1]
            bl = math.hypot(bx, by)
            out.append((p1[0] + bx / bl * miter, p1[1] + by / bl * miter))
    return out


# ----------------------------------------------------------------------------- concepts
# A face: dict(pts=[(x, y, z), ...] convex & planar, tone=0|1|2 or "accent", name)
# (concave faces are given as several convex parts sharing the same name/tone)

def concept_A():
    """Origami canary: a small perched paper bird, side-on (looking along +Y), facing right.
    x right, z up, y depth (more negative = nearer). Five facets + the beak."""
    crown, nape, throat, bbase = (0.12, -0.10, 0.96), (-0.22, -0.05, 0.60), (0.40, -0.12, 0.50), (0.42, -0.12, 0.78)
    tip = (0.72, -0.14, 0.63)
    belly, back = (0.20, 0.00, -0.22), (-0.56, 0.02, 0.22)
    sh, wtip, wfront = (-0.10, -0.40, 0.50), (-0.80, -0.36, -0.32), (0.14, -0.40, 0.04)
    rump, ttip, tlow = (-0.44, 0.05, -0.04), (-0.94, 0.08, -0.66), (-0.28, 0.06, -0.32)
    faces = [
        dict(name="tail", pts=[rump, ttip, tlow], tone=1),
        dict(name="breast", pts=[nape, throat, belly, back], tone=2),
        dict(name="head", pts=[nape, crown, bbase, throat], tone=1),
        dict(name="beak", pts=[bbase, tip, throat], tone="accent"),
        dict(name="wing", pts=[sh, wfront, wtip], tone=0),
    ]
    cam = dict(kind="ORTHO", loc=(0.0, -10.0, 0.15), rot=(90.0, 0.0, 0.0))
    return faces, cam


def concept_B(segments=5, a0=52.0, a1=308.0, R=1.0, h=0.95):
    """Folded C: one strip folded into an open polygonal ring (a key's bow), in perspective.
    The ring lies in the XZ plane (we read it as a C), the strip's width runs along +Y (away)."""
    pts = [(R * math.cos(math.radians(a0 + (a1 - a0) * i / segments)), 0.0,
            R * math.sin(math.radians(a0 + (a1 - a0) * i / segments))) for i in range(segments + 1)]
    faces = []
    for i in range(segments):
        p, q = pts[i], pts[i + 1]
        mid = ((p[0] + q[0]) / 2, 0.0, (p[2] + q[2]) / 2)
        faces.append(dict(name=f"seg{i}", pts=[p, (p[0], h, p[2]), (q[0], h, q[2]), q], tone=None,
                          outward=(mid[0], 0.0, mid[2])))
    cam = dict(kind="PERSP", target=(0.0, h / 2, 0.0), yaw=-26.0, pitch=30.0, dist=6.5, lens=55.0)
    return faces, cam


def concept_C(s0=0.34, z0=0.335, z1=0.665, depth=1.0):  # (FINAL below holds the shipped sizes)
    """A sealed cube with a slot cut through it, so the cube reads as a C (the enclave), isometric.
    x right, y back, z up; the slot opens on +x and runs front to back."""
    d = depth
    front = [  # the C profile on the front face (y = 0), as three convex parts
        [(0, 0, 0), (s0, 0, 0), (s0, 0, 1), (0, 0, 1)],
        [(s0, 0, z1), (1, 0, z1), (1, 0, 1), (s0, 0, 1)],
        [(s0, 0, 0), (1, 0, 0), (1, 0, z0), (s0, 0, z0)],
    ]
    # explicit painter order (far to near): the creases are always cut from the lighter faces and the
    # ink C on the front stays whole (centroid depth sorting let the front and the top take turns)
    faces = [dict(name="front", pts=p, tone=0, order=5) for p in front]
    faces += [
        dict(name="top", pts=[(0, 0, 1), (1, 0, 1), (1, d, 1), (0, d, 1)], tone=2, order=2),
        dict(name="right_upper", pts=[(1, 0, z1), (1, d, z1), (1, d, 1), (1, 0, 1)], tone=1, order=3),
        dict(name="right_lower", pts=[(1, 0, 0), (1, d, 0), (1, d, z0), (1, 0, z0)], tone=1, order=4),
        dict(name="slot_floor", pts=[(s0, 0, z0), (1, 0, z0), (1, d, z0), (s0, d, z0)], tone=2, order=1),
        dict(name="slot_back", pts=[(s0, 0, z0), (s0, d, z0), (s0, d, z1), (s0, 0, z1)], tone="accent", order=0),
    ]
    cam = dict(kind="ORTHO", iso=True)
    return faces, cam


CONCEPTS = {
    "A": ("Origami canary", concept_A),
    "B": ("Folded C (key bow)", concept_B),
    "C": ("Slotted cube C (enclave)", concept_C),
}


# ----------------------------------------------------------------------------- blender + projection
def build_in_blender(key, faces):
    bm = bmesh.new()
    for f in faces:
        vs = [bm.verts.new(p) for p in f["pts"]]
        bm.faces.new(vs)
    me = bpy.data.meshes.new(f"mark_{key}")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(f"mark_{key}", me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def make_camera(spec, faces):
    cd = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cd)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    allp = [Vector(p) for f in faces for p in f["pts"]]
    centre = sum(allp, Vector()) / len(allp)
    if spec.get("iso"):
        cd.type = "ORTHO"
        cam.rotation_euler = (math.radians(54.7356), 0.0, math.radians(45.0))
        fwd = cam.rotation_euler.to_matrix() @ Vector((0, 0, -1))
        cam.location = centre - fwd * 10.0
    elif spec["kind"] == "ORTHO":
        cd.type = "ORTHO"
        cam.location = spec["loc"]
        cam.rotation_euler = [math.radians(a) for a in spec["rot"]]
    else:
        cd.type = "PERSP"
        cd.lens = spec["lens"]
        yaw, pitch = math.radians(spec["yaw"]), math.radians(spec["pitch"])
        tgt = Vector(spec["target"])
        # camera on the -Y side (in front of the C), swung by yaw about Z and raised by pitch
        dirv = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
        cam.location = tgt + dirv * spec["dist"]
        cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()
    return cam


def project(cam, faces):
    """Faces -> 2D polygons (y up) in camera space, depth, and facing (|n . view|)."""
    inv = cam.matrix_world.inverted()
    persp = cam.data.type == "PERSP"
    out = []
    for f in faces:
        cs = [inv @ Vector(p) for p in f["pts"]]
        if persp:
            p2 = [(c.x / -c.z, c.y / -c.z) for c in cs]
        else:
            p2 = [(c.x, c.y) for c in cs]
        n = (cs[1] - cs[0]).cross(cs[2] - cs[0]).normalized()
        if "outward" in f:                       # strip faces: orient by the ring's outside
            ow = inv.to_3x3() @ Vector(f["outward"])
            if n.dot(ow) < 0:
                n = -n
        centre = sum(cs, Vector()) / len(cs)
        view = (-centre).normalized() if persp else Vector((0, 0, 1))
        facing = n.dot(view)
        out.append(dict(name=f["name"], tone=f["tone"], pts=ccw(p2), depth=-centre.z, facing=facing,
                        outer=facing > 0, order=f.get("order")))
    return out


def auto_tone(f):
    """Strip faces with no fixed tone: the outside of the strip facing us is the deep ink, the
    outside turned away is the middle tone, and the inside (seen through the C) is the palest."""
    if f["tone"] is not None:
        return f["tone"]
    if f["facing"] > 0:
        return 0 if abs(f["facing"]) > 0.5 else 1
    return 2


def flatten(proj, gap_frac):
    """Painter's order with knock-out creases: far to near, each face cuts a gap out of the ones behind."""
    allp = [p for f in proj for p in f["pts"]]
    xs, ys = [p[0] for p in allp], [p[1] for p in allp]
    size = max(max(xs) - min(xs), max(ys) - min(ys))
    gap = gap_frac * size
    if all(f.get("order") is not None for f in proj):
        order = sorted(proj, key=lambda f: f["order"])
    else:
        order = sorted(proj, key=lambda f: -f["depth"])
    placed = []                                       # [name, tone, [pieces]]
    for f in order:
        cutter = expand(f["pts"], gap)
        for item in placed:
            if item[0] == f["name"]:
                continue                              # parts of one concave face never gap each other
            new = []
            for piece in item[2]:
                new.extend(subtract(piece, cutter))
            item[2] = new
        placed.append([f["name"], auto_tone(f), [f["pts"]]])
    return placed


def to_box(placed, pad=None):
    pad = PAD if pad is None else pad
    allp = [p for _, _, pcs in placed for poly in pcs for p in poly]
    x0, x1 = min(p[0] for p in allp), max(p[0] for p in allp)
    y0, y1 = min(p[1] for p in allp), max(p[1] for p in allp)
    s = (100.0 * (1 - 2 * pad)) / max(x1 - x0, y1 - y0)
    ox = 50.0 - (x0 + x1) / 2 * s
    oy = 50.0 + (y0 + y1) / 2 * s
    out, by_name = [], {}
    for name, tone, pcs in placed:
        polys = [[(round(ox + x * s, 2), round(oy - y * s, 2)) for x, y in poly] for poly in pcs]
        polys = [p for p in polys if len(p) >= 3]
        if name in by_name and by_name[name]["tone"] == tone:      # parts of one face -> one <path>
            by_name[name]["polys"].extend(polys)
            continue
        by_name[name] = dict(name=name, tone=tone, polys=polys)
        out.append(by_name[name])
    return out


def svg(shapes, variant):
    tones = TONES[variant]
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="1024" height="1024">']
    for sh in shapes:
        if not sh["polys"]:
            continue
        fill = CANARY if sh["tone"] == "accent" else tones[sh["tone"]]
        d = " ".join("M" + " ".join(f"{x:g},{y:g}" for x, y in poly) + "Z" for poly in sh["polys"])
        parts.append(f'<path d="{d}" fill="{fill}"/>')
    parts.append("</svg>")
    return "".join(parts)


# ----------------------------------------------------------------------------- the pick (concept C)
# Two optical sizes of the same model: "large" for >= 64 px (and all vector use), "small" for
# favicons (<= 48 px): a taller slot so the canary facet keeps ~4 fully saturated pixels at 16 px,
# no crease gaps (at that size the tones separate the facets and a gap would eat the canary), and
# no padding (every pixel counts).
FINAL = {
    "large": dict(s0=0.34, z0=0.335, z1=0.665, gap=0.016, pad=0.06),
    "small": dict(s0=0.26, z0=0.25, z1=0.75, gap=0.0, pad=0.0),
}


def final_shapes(params, mono=False):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    faces, cam_spec = concept_C(params["s0"], params["z0"], params["z1"])
    if mono:   # one ink: drop the slot's inside so the notch stays negative space
        faces = [f for f in faces if f["name"] not in ("slot_floor", "slot_back")]
    build_in_blender("C", faces)
    cam = make_camera(cam_spec, faces)
    return to_box(flatten(project(cam, faces), params["gap"]), pad=params["pad"])


def svg_mono(shapes):
    d = " ".join("M" + " ".join(f"{x:g},{y:g}" for x, y in poly) + "Z" for sh in shapes for poly in sh["polys"])
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="1024" height="1024">'
            f'<path d="{d}" fill="currentColor"/></svg>')


def svg_auto(shapes):
    """One file for both schemes (favicon): paper tones, night tones under prefers-color-scheme: dark."""
    p, n = TONES["paper"], TONES["night"]
    style = (f".t0{{fill:{p[0]}}}.t1{{fill:{p[1]}}}.t2{{fill:{p[2]}}}.a{{fill:{CANARY}}}"
             f"@media (prefers-color-scheme:dark){{.t0{{fill:{n[0]}}}.t1{{fill:{n[1]}}}.t2{{fill:{n[2]}}}}}")
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="32" height="32"><style>{style}</style>']
    for sh in shapes:
        if not sh["polys"]:
            continue
        cls = "a" if sh["tone"] == "accent" else f"t{sh['tone']}"
        d = " ".join("M" + " ".join(f"{x:g},{y:g}" for x, y in poly) + "Z" for poly in sh["polys"])
        parts.append(f'<path class="{cls}" d="{d}"/>')
    parts.append("</svg>")
    return "".join(parts)


def write_final(out):
    os.makedirs(out, exist_ok=True)
    data = dict(tones=TONES, canary=CANARY, sizes={})
    for size, params in FINAL.items():
        shapes = final_shapes(params)
        mono = final_shapes(params, mono=True)
        stem = "mark" if size == "large" else "mark-small"
        for variant in ("paper", "night"):
            with open(os.path.join(out, f"{stem}-{variant}.svg"), "w") as fh:
                fh.write(svg(shapes, variant))
        with open(os.path.join(out, f"{stem}-mono.svg"), "w") as fh:
            fh.write(svg_mono(mono))
        if size == "small":
            with open(os.path.join(out, "icon.svg"), "w") as fh:
                fh.write(svg_auto(shapes))
        data["sizes"][size] = dict(params=params, shapes=shapes, mono=mono)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.abspath(out), f"{stem}.blend"))
        print(f"[logo] final {size}: {sum(len(s['polys']) for s in shapes)} polygons", flush=True)
    with open(os.path.join(out, "mark.json"), "w") as fh:
        json.dump(data, fh)


def main():
    args = parse_args()
    if args.final:
        write_final(args.final)
        return
    os.makedirs(args.out, exist_ok=True)
    for key in [k.strip() for k in args.concepts.split(",") if k.strip()]:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        title, fn = CONCEPTS[key]
        faces, cam_spec = fn()
        build_in_blender(key, faces)
        cam = make_camera(cam_spec, faces)
        proj = project(cam, faces)
        shapes = to_box(flatten(proj, GAP))
        for variant in ("paper", "night"):
            with open(os.path.join(args.out, f"{key}.{variant}.svg"), "w") as fh:
                fh.write(svg(shapes, variant))
        with open(os.path.join(args.out, f"{key}.json"), "w") as fh:
            json.dump(dict(key=key, title=title, tones=TONES, canary=CANARY, shapes=shapes), fh)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.abspath(args.out), f"{key}.blend"))
        n = sum(len(s["polys"]) for s in shapes)
        print(f"[logo] {key} '{title}': {len(shapes)} facets, {n} polygons", flush=True)
        for f in proj:
            print(f"[logo]   {f['name']:12s} depth {f['depth']:.2f} facing {f['facing']:+.2f} tone {auto_tone(f)}")


if __name__ == "__main__":
    main()
