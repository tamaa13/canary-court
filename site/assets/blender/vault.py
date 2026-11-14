"""
Canary Court - "vault + key" scroll-story scene (procedural, Blender 5.2 / Cycles).

Builds the whole scene from code (no external assets, procedural world), animates the
camera over 221 frames and renders RGBA PNG frames. See README.md next to this file.

  nice -n 10 /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
      -P site/assets/blender/vault.py -- --frames 0,110,220

Options (after the "--"):
  --frames 0,110,220   render these frames            (default: all 0..220)
  --range 0-220        render an inclusive range
  --out DIR            PNG output dir                 (default: site/assets/blender/.render/png)
  --samples N          max adaptive samples           (default 512)
  --noise T            adaptive noise threshold       (default 0.01)
  --pct P              resolution percentage          (default 100 -> 1600x1000)
  --overwrite          re-render frames that already exist (default: skip = resumable)
  --save FILE.blend    also save the built scene
  --meta FILE.json     write projected rects (key in f0, vault in f160/f220)
  --no-render          build (+save/meta) only
  --cpu                render on CPU instead of Metal GPU
  --floor KIND         holdout (shipped: floor invisible to the camera until ~f62-f80)
                       | gunmetal (dark floor from f0) | stone (light floor) | catcher
  --exposure EV        view exposure override
  --report             per-frame safe-area table (projected vault/key bounds)
  --set NAME=value     dev: override a module constant (e.g. --set D220=8.4); repeatable
"""

import argparse
import json
import math
import os
import sys
import time

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))

# ----------------------------------------------------------------------------- spec
W, H = 1600, 1000
N_FRAMES = 221                     # f000 .. f220

# scene units: the vault cube is 1.0 on a side
S = 1.0                            # vault outer size
B = 0.06                           # frame beam section
GLASS_T = 0.012                    # glass panel thickness
PL = 1.34                          # plinth footprint
PL_H = 0.45                        # plinth height (top at z=0, vault sits on it)
ZK = 0.40                          # key plane height (key lies flat, "turned" in the lock)
OX = 0.0675                        # shifts key+lock so the assembly is centred on x=0
KS = 1.2                           # key+lock scale (about the point (0, 0, ZK))
ROLL = 32.0                        # deg: key+lock rolled about the cylinder axis so the enamel
                                   # head tips toward the f220 camera (teeth edge rises)

# key (local x before OX; blade points +x into the lock)
BLADE_W = 0.021                    # half width of the blade
BLADE_T = 0.012                    # blade thickness
X_SHOULDER = -0.115
X_TIP = 0.20
X_FLANGE = -0.02                   # front face of the lock flange
HEAD_A, HEAD_B, HEAD_N = 0.095, 0.08, 3.2
HEAD_T = 0.024
X_HEAD = X_SHOULDER - 0.045 - HEAD_A
HOLE_X, HOLE_R = X_HEAD - 0.047, 0.0208
CUT_DEPTHS = [0.007, 0.012, 0.0085, 0.013, 0.006, 0.0105]
CUT_SPACING, CUT_ROOT = 0.0155, 0.002

CANARY = (0.6445, 0.4233, 0.0452)  # #D2AE3C in linear
LIGHT_KEY, LIGHT_FILL, LIGHT_RIM, WORLD_BLOB = 450.0, 140.0, 300.0, 0.8
EXPOSURE = 0.0
SMOKE = (0.72, 0.72, 0.715)        # per-interface transmission tint (neutral)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="vault.py")
    p.add_argument("--frames", default="")
    p.add_argument("--range", default="")
    p.add_argument("--out", default=os.path.join(HERE, ".render", "png"))
    p.add_argument("--samples", type=int, default=512)
    p.add_argument("--noise", type=float, default=0.01)
    p.add_argument("--pct", type=int, default=100)
    p.add_argument("--overwrite", action="store_true")
    p.add_argument("--save", default="")
    p.add_argument("--meta", default="")
    p.add_argument("--no-render", action="store_true")
    p.add_argument("--cpu", action="store_true")
    p.add_argument("--exposure", type=float, default=None)
    p.add_argument("--floor", default="holdout", choices=["gunmetal", "stone", "holdout", "catcher"])
    p.add_argument("--set", action="append", default=[], help="dev: override a module constant, NAME=value")
    p.add_argument("--report", action="store_true", help="print per-frame safe-area / coverage report")
    return p.parse_args(argv)


# ----------------------------------------------------------------------------- math
def clamp01(x):
    return max(0.0, min(1.0, x))


def smoothstep(x):
    x = clamp01(x)
    return x * x * (3 - 2 * x)


def smootherstep(x):
    x = clamp01(x)
    return x * x * x * (x * (6 * x - 15) + 10)


def lerp(a, b, t):
    return a + (b - a) * t


def pchip(keys, x):
    """Monotone cubic through (x, y) keys, zero slope at both ends (ease in/out)."""
    xs = [k[0] for k in keys]
    ys = [k[1] for k in keys]
    n = len(keys)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    for i in range(1, n - 1):
        if d[i - 1] * d[i] > 0:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    x = min(max(x, xs[0]), xs[-1])
    i = min(n - 2, max(0, next((j for j in range(n - 1) if x <= xs[j + 1]), n - 2)))
    t = (x - xs[i]) / h[i]
    t2, t3 = t * t, t * t * t
    return ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i]
            + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1])


def signed_area(pts):
    return 0.5 * sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
                     for i in range(len(pts)))


# ----------------------------------------------------------------------------- mesh helpers
def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def mesh_obj(name, bm, mat=None):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    if mat is not None:
        me.materials.append(mat)
    return ob


def bm_box(bm, lo, hi):
    c = [(lo[i] + hi[i]) / 2 for i in range(3)]
    s = [hi[i] - lo[i] for i in range(3)]
    mtx = Matrix.Translation(c) @ Matrix.Diagonal((s[0], s[1], s[2], 1.0))
    bmesh.ops.create_cube(bm, size=1.0, matrix=mtx)


def bm_prism(bm, pts, z0, z1):
    if signed_area(pts) < 0:
        pts = pts[::-1]
    bot = [bm.verts.new((x, y, z0)) for x, y in pts]
    top = [bm.verts.new((x, y, z1)) for x, y in pts]
    bm.faces.new(bot[::-1])
    bm.faces.new(top)
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], top[j], top[i]))


def bm_lathe(bm, prof, axis, center, segs=96):
    """Revolve a closed (a, r) profile around `axis` ('X' or 'Z') through `center`."""
    cx, cy, cz = center
    rings = []
    for a, r in prof:
        ring = []
        for k in range(segs):
            t = 2 * math.pi * k / segs
            if axis == "X":
                co = (cx + a, cy + r * math.cos(t), cz + r * math.sin(t))
            else:
                co = (cx + r * math.cos(t), cy + r * math.sin(t), cz + a)
            ring.append(bm.verts.new(co))
        rings.append(ring)
    n = len(rings)
    for j in range(n):
        j2 = (j + 1) % n
        for k in range(segs):
            k2 = (k + 1) % segs
            bm.faces.new((rings[j][k], rings[j2][k], rings[j2][k2], rings[j][k2]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-7)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])


def bm_holed_prism(bm, inside_fn, hc, hr, z0, z1, segs=192):
    """Prism of a convex-ish outline (inside_fn(x,y)->bool) with a round hole, all quads."""
    inner, outer = [], []
    for k in range(segs):
        a = 2 * math.pi * k / segs
        d = (math.cos(a), math.sin(a))
        lo, hi = hr, 2.0
        for _ in range(60):
            mid = (lo + hi) / 2
            if inside_fn(hc[0] + d[0] * mid, hc[1] + d[1] * mid):
                lo = mid
            else:
                hi = mid
        inner.append((hc[0] + d[0] * hr, hc[1] + d[1] * hr))
        outer.append((hc[0] + d[0] * lo, hc[1] + d[1] * lo))
    ob_ = [bm.verts.new((x, y, z0)) for x, y in outer]
    ot_ = [bm.verts.new((x, y, z1)) for x, y in outer]
    ib_ = [bm.verts.new((x, y, z0)) for x, y in inner]
    it_ = [bm.verts.new((x, y, z1)) for x, y in inner]
    for k in range(segs):
        k2 = (k + 1) % segs
        bm.faces.new((ot_[k], ot_[k2], it_[k2], it_[k]))       # top
        bm.faces.new((ob_[k2], ob_[k], ib_[k], ib_[k2]))       # bottom
        bm.faces.new((ob_[k], ob_[k2], ot_[k2], ot_[k]))       # outer wall
        bm.faces.new((ib_[k2], ib_[k], it_[k], it_[k2]))       # hole wall
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])


def smooth(ob, deg=30.0):
    me = ob.data
    for p in me.polygons:
        p.use_smooth = True
    try:
        me.set_sharp_from_angle(angle=math.radians(deg))
    except Exception as e:  # pragma: no cover
        print("[vault] set_sharp_from_angle unavailable:", e)


def bevel(ob, width, segs=3, deg=30.0):
    m = ob.modifiers.new("bevel", "BEVEL")
    m.width = width
    m.segments = segs
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(deg)
    m.use_clamp_overlap = True
    m.harden_normals = True
    return m


def apply_booleans(ob, cutters):
    for c in cutters:
        m = ob.modifiers.new("cut", "BOOLEAN")
        m.operation = "DIFFERENCE"
        m.object = c
        m.solver = "EXACT"
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)
    for c in cutters:
        cm = c.data
        bpy.data.objects.remove(c, do_unlink=True)
        bpy.data.meshes.remove(cm)


def cutter_box(name, lo, hi):
    bm = bmesh.new()
    bm_box(bm, lo, hi)
    ob = mesh_obj(name, bm)
    ob.hide_render = True
    return ob


# ----------------------------------------------------------------------------- materials
def new_mat(name):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    return m, nt, out


def node(nt, typ, **props):
    n = nt.nodes.new(typ)
    for k, v in props.items():
        setattr(n, k, v)
    return n


def sock(n, *names):
    for nm in names:
        if nm in n.inputs:
            return n.inputs[nm]
    raise KeyError(f"{n.bl_idname}: none of {names}")


def setv(n, names, v):
    if isinstance(names, str):
        names = (names,)
    s = sock(n, *names)
    if isinstance(v, (tuple, list)) and len(v) == 3 and len(s.default_value) == 4:
        v = (*v, 1.0)
    s.default_value = v


def principled(nt, base=(0.8, 0.8, 0.8), metal=0.0, rough=0.5, spec=0.5, aniso=0.0,
               trans=0.0, ior=1.5, coat=0.0):
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    setv(b, "Base Color", base)
    setv(b, "Metallic", metal)
    setv(b, "Roughness", rough)
    setv(b, "IOR", ior)
    setv(b, ("Specular IOR Level", "Specular"), spec)
    setv(b, "Anisotropic", aniso)
    setv(b, ("Transmission Weight", "Transmission"), trans)
    setv(b, ("Coat Weight", "Clearcoat"), coat)
    return b


def mat_brushed(name, color, rough, aniso=0.7, brush="X", streak=380.0, rvar=0.06, bump=0.012):
    """Brushed metal. brush = 'X' | 'Y' | 'Z' (linear) or 'RX' / 'RZ' (lathe-turned around X / Z)."""
    m, nt, out = new_mat(name)
    L = nt.links.new
    tc = node(nt, "ShaderNodeTexCoord")
    nz = node(nt, "ShaderNodeTexNoise")
    setv(nz, "Detail", 8.0)
    setv(nz, "Roughness", 0.55)
    b = principled(nt, base=color, metal=1.0, rough=rough, aniso=aniso)
    if brush in ("X", "Y", "Z"):
        i = "XYZ".index(brush)
        mp = node(nt, "ShaderNodeMapping")
        sc = [streak] * 3
        sc[i] = 1.5
        mp.inputs["Scale"].default_value = sc
        L(tc.outputs["Object"], mp.inputs["Vector"])
        L(mp.outputs["Vector"], nz.inputs["Vector"])
        setv(nz, "Scale", 1.0)
        tv = [0.03, 0.05, 0.04]          # never exactly parallel to a face normal
        tv[i] = 1.0
        cx = node(nt, "ShaderNodeCombineXYZ")
        for k, v in zip("XYZ", tv):
            cx.inputs[k].default_value = v
        L(cx.outputs[0], sock(b, "Tangent"))
    else:
        ax = brush[1]
        sp = node(nt, "ShaderNodeSeparateXYZ")
        L(tc.outputs["Object"], sp.inputs[0])
        other = [c for c in "XYZ" if c != ax]
        cr = node(nt, "ShaderNodeCombineXYZ")
        L(sp.outputs[other[0]], cr.inputs["X"])
        L(sp.outputs[other[1]], cr.inputs["Y"])
        ln = node(nt, "ShaderNodeVectorMath", operation="LENGTH")
        L(cr.outputs[0], ln.inputs[0])
        cv = node(nt, "ShaderNodeCombineXYZ")
        L(sp.outputs[ax], cv.inputs["X"])
        L(ln.outputs["Value"], cv.inputs["Y"])
        L(cv.outputs[0], nz.inputs["Vector"])
        setv(nz, "Scale", streak)
        tg = node(nt, "ShaderNodeTangent", direction_type="RADIAL", axis=ax)
        L(tg.outputs["Tangent"], sock(b, "Tangent"))
    mr = node(nt, "ShaderNodeMapRange")
    L(nz.outputs["Fac"], mr.inputs["Value"])
    mr.inputs["From Min"].default_value = 0.3
    mr.inputs["From Max"].default_value = 0.7
    mr.inputs["To Min"].default_value = max(0.02, rough - rvar)
    mr.inputs["To Max"].default_value = rough + rvar
    L(mr.outputs["Result"], sock(b, "Roughness"))
    if bump > 0:
        bp = node(nt, "ShaderNodeBump")
        setv(bp, "Strength", bump)
        setv(bp, "Distance", 0.001)
        L(nz.outputs["Fac"], sock(bp, "Height"))
        L(bp.outputs["Normal"], sock(b, "Normal"))
    L(b.outputs[0], out.inputs["Surface"])
    return m


def mat_enamel(name, color):
    m, nt, out = new_mat(name)
    L = nt.links.new
    tc = node(nt, "ShaderNodeTexCoord")
    nz = node(nt, "ShaderNodeTexNoise")
    setv(nz, "Scale", 22.0)
    setv(nz, "Detail", 4.0)
    L(tc.outputs["Object"], nz.inputs["Vector"])
    b = principled(nt, base=color, rough=0.46, spec=0.45)
    mr = node(nt, "ShaderNodeMapRange")
    L(nz.outputs["Fac"], mr.inputs["Value"])
    mr.inputs["To Min"].default_value = 0.40
    mr.inputs["To Max"].default_value = 0.54
    L(mr.outputs["Result"], sock(b, "Roughness"))
    L(b.outputs[0], out.inputs["Surface"])
    return m


def mat_glass(name):
    """Smoked neutral glass. Shadow/diffuse rays pass through tinted-transparent (lights the
    interior without caustic noise); camera rays see plain transparency until `glass_fade`
    ramps to 1 (the camera starts *inside* the vault and rises through the lid)."""
    m, nt, out = new_mat(name)
    L = nt.links.new
    lp = node(nt, "ShaderNodeLightPath")
    g = principled(nt, base=SMOKE, rough=0.012, trans=1.0, ior=1.5, spec=0.3)   # softer ghosts
    ts = node(nt, "ShaderNodeBsdfTransparent")
    ts.inputs["Color"].default_value = (0.88, 0.88, 0.875, 1.0)
    tcam = node(nt, "ShaderNodeBsdfTransparent")
    tcam.inputs["Color"].default_value = (1, 1, 1, 1)
    mx = node(nt, "ShaderNodeMath", operation="MAXIMUM")
    L(lp.outputs["Is Shadow Ray"], mx.inputs[0])
    L(lp.outputs["Is Diffuse Ray"], mx.inputs[1])
    m1 = node(nt, "ShaderNodeMixShader")
    L(mx.outputs[0], m1.inputs[0])
    L(g.outputs[0], m1.inputs[1])
    L(ts.outputs[0], m1.inputs[2])
    fade = node(nt, "ShaderNodeValue", name="glass_fade", label="glass_fade")
    fade.outputs[0].default_value = 1.0
    om = node(nt, "ShaderNodeMath", operation="SUBTRACT")
    om.inputs[0].default_value = 1.0
    L(fade.outputs[0], om.inputs[1])
    # a camera ray reaching a BACK face already passed the front face transparently: keep it
    # transparent too, otherwise it refracts on exit only and the slab acts as a lens (ghosting)
    geo = node(nt, "ShaderNodeNewGeometry")
    bf = node(nt, "ShaderNodeMath", operation="MAXIMUM")
    L(om.outputs[0], bf.inputs[0])
    L(geo.outputs["Backfacing"], bf.inputs[1])
    fc = node(nt, "ShaderNodeMath", operation="MULTIPLY")
    L(lp.outputs["Is Camera Ray"], fc.inputs[0])
    L(bf.outputs[0], fc.inputs[1])
    m2 = node(nt, "ShaderNodeMixShader")
    L(fc.outputs[0], m2.inputs[0])
    L(m1.outputs[0], m2.inputs[1])
    L(tcam.outputs[0], m2.inputs[2])
    L(m2.outputs[0], out.inputs["Surface"])
    return m, fade


def mat_stone(name, lo=(0.300, 0.279, 0.252), hi=(0.352, 0.330, 0.298), rough=0.82):
    m, nt, out = new_mat(name)
    L = nt.links.new
    tc = node(nt, "ShaderNodeTexCoord")
    nz = node(nt, "ShaderNodeTexNoise")
    setv(nz, "Scale", 3.5)
    setv(nz, "Detail", 6.0)
    setv(nz, "Roughness", 0.6)
    L(tc.outputs["Object"], nz.inputs["Vector"])
    ramp = node(nt, "ShaderNodeValToRGB")
    e = ramp.color_ramp.elements
    e[0].position, e[0].color = 0.3, (*lo, 1)
    e[1].position, e[1].color = 0.7, (*hi, 1)
    L(nz.outputs["Fac"], ramp.inputs["Fac"])
    vo = node(nt, "ShaderNodeTexVoronoi")
    setv(vo, "Scale", 160.0)
    L(tc.outputs["Object"], vo.inputs["Vector"])
    sp = node(nt, "ShaderNodeMapRange")
    L(vo.outputs["Distance"], sp.inputs["Value"])
    sp.inputs["From Min"].default_value = 0.0
    sp.inputs["From Max"].default_value = 0.07
    sp.inputs["To Min"].default_value = 0.86
    sp.inputs["To Max"].default_value = 1.0
    mul = node(nt, "ShaderNodeVectorMath", operation="SCALE")
    L(ramp.outputs["Color"], mul.inputs[0])
    L(sp.outputs["Result"], sock(mul, "Scale"))
    b = principled(nt, rough=rough, spec=0.35)
    L(mul.outputs["Vector"], sock(b, "Base Color"))
    nz2 = node(nt, "ShaderNodeTexNoise")
    setv(nz2, "Scale", 90.0)
    setv(nz2, "Detail", 3.0)
    L(tc.outputs["Object"], nz2.inputs["Vector"])
    bp = node(nt, "ShaderNodeBump")
    setv(bp, "Strength", 0.05)
    setv(bp, "Distance", 0.002)
    L(nz2.outputs["Fac"], sock(bp, "Height"))
    L(bp.outputs["Normal"], sock(b, "Normal"))
    L(b.outputs[0], out.inputs["Surface"])
    return m


def holdout_for_camera(m):
    """Camera rays see a holdout (alpha 0) until the `floor_fade` value ramps to 1."""
    nt = m.node_tree
    out = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial")
    src = out.inputs["Surface"].links[0].from_socket
    L = nt.links.new
    lp = node(nt, "ShaderNodeLightPath")
    ho = node(nt, "ShaderNodeHoldout")
    fade = node(nt, "ShaderNodeValue", name="floor_fade", label="floor_fade")
    om = node(nt, "ShaderNodeMath", operation="SUBTRACT")
    om.inputs[0].default_value = 1.0
    L(fade.outputs[0], om.inputs[1])
    # camera rays, and camera rays that went *through* the glass lid (transmission)
    cr = node(nt, "ShaderNodeMath", operation="MAXIMUM")
    L(lp.outputs["Is Camera Ray"], cr.inputs[0])
    L(lp.outputs["Is Transmission Ray"], cr.inputs[1])
    fc = node(nt, "ShaderNodeMath", operation="MULTIPLY")
    L(cr.outputs[0], fc.inputs[0])
    L(om.outputs[0], fc.inputs[1])
    mx = node(nt, "ShaderNodeMixShader")
    L(fc.outputs[0], mx.inputs[0])
    L(src, mx.inputs[1])
    L(ho.outputs[0], mx.inputs[2])
    L(mx.outputs[0], out.inputs["Surface"])
    return fade


def mat_plain(name, color, rough=0.6):
    m, nt, out = new_mat(name)
    b = principled(nt, base=color, rough=rough)
    nt.links.new(b.outputs[0], out.inputs["Surface"])
    return m


# ----------------------------------------------------------------------------- scene
def build_world():
    w = bpy.data.worlds.new("studio")
    try:
        w.use_nodes = True
    except Exception:
        pass
    bpy.context.scene.world = w
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    L = nt.links.new
    out = nt.nodes.new("ShaderNodeOutputWorld")
    tc = node(nt, "ShaderNodeTexCoord")
    sp = node(nt, "ShaderNodeSeparateXYZ")
    L(tc.outputs["Generated"], sp.inputs[0])
    mr = node(nt, "ShaderNodeMapRange")
    L(sp.outputs["Z"], mr.inputs["Value"])
    mr.inputs["From Min"].default_value = -0.2
    mr.inputs["From Max"].default_value = 0.95
    ramp = node(nt, "ShaderNodeValToRGB")
    e = ramp.color_ramp.elements
    e[0].position, e[0].color = 0.0, (0.014, 0.013, 0.012, 1)
    e[1].position, e[1].color = 1.0, (0.26, 0.26, 0.26, 1)
    mid = e.new(0.22)
    mid.color = (0.10, 0.098, 0.094, 1)
    L(mr.outputs["Result"], ramp.inputs["Fac"])
    # soft overhead softbox (gives brushed metal a gradient to reflect in top-down shots)
    dv = Vector((-0.25, -0.25, 0.93)).normalized()   # front-left: soft shadows fall right/back
    dt = node(nt, "ShaderNodeVectorMath", operation="DOT_PRODUCT")
    L(tc.outputs["Generated"], dt.inputs[0])
    dt.inputs[1].default_value = dv
    bl = node(nt, "ShaderNodeMapRange", interpolation_type="SMOOTHERSTEP")
    L(dt.outputs["Value"], bl.inputs["Value"])
    bl.inputs["From Min"].default_value = math.cos(math.radians(38))
    bl.inputs["From Max"].default_value = math.cos(math.radians(8))
    bl.inputs["To Max"].default_value = WORLD_BLOB
    ad = node(nt, "ShaderNodeVectorMath", operation="ADD")
    L(ramp.outputs["Color"], ad.inputs[0])
    L(bl.outputs["Result"], ad.inputs[1])
    bg = node(nt, "ShaderNodeBackground")
    setv(bg, "Strength", 1.0)
    L(ad.outputs["Vector"], bg.inputs["Color"])
    L(bg.outputs[0], out.inputs["Surface"])


def area_light(name, pos, target, size, size_y, energy, color=(1, 1, 1), shadow=True):
    ld = bpy.data.lights.new(name, "AREA")
    ld.shape = "RECTANGLE"
    ld.size, ld.size_y = size, size_y
    ld.energy = energy
    ld.color = color
    ob = link(bpy.data.objects.new(name, ld))
    ob.location = pos
    d = Vector(target) - Vector(pos)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    ob.visible_camera = False
    ld.use_shadow = shadow
    return ob


def build_lights():
    # all lights sit below ~40deg elevation so none of them mirrors in the lid in top-down shots
    c = (0, 0, 0.35)
    area_light("key", (-4.4, -2.4, 3.0), c, 3.6, 2.8, LIGHT_KEY, (1.0, 0.975, 0.94))
    area_light("fill", (4.0, -3.4, 1.6), c, 3.5, 3.0, LIGHT_FILL, (0.94, 0.97, 1.0), shadow=False)
    area_light("rim", (2.4, 4.8, 3.6), c, 3.4, 1.0, LIGHT_RIM, (1.0, 0.99, 0.97), shadow=False)


def build_vault(m_steel_x, m_steel_y, m_steel_z, m_glass, m_floor):
    h = S / 2
    i = h - B           # inner face of the frame
    # 12 beams: X-beams run the full length, Y/Z beams butt between them
    bx, by, bz = bmesh.new(), bmesh.new(), bmesh.new()
    for y in (-h, h - B):
        for z in (0.0, S - B):
            bm_box(bx, (-h, y, z), (h, y + B, z + B))
    for x in (-h, h - B):
        for z in (0.0, S - B):
            bm_box(by, (x, -i, z), (x + B, i, z + B))
    for x in (-h, h - B):
        for y in (-h, h - B):
            bm_box(bz, (x, y, B), (x + B, y + B, S - B))
    for nm, bm, m in (("frame_x", bx, m_steel_x), ("frame_y", by, m_steel_y), ("frame_z", bz, m_steel_z)):
        ob = mesh_obj(nm, bm, m)
        smooth(ob)
        bevel(ob, 0.0035, 3)
    # floor plate (top flush with the bottom beams)
    bm = bmesh.new()
    bm_box(bm, (-i - 0.005, -i - 0.005, B - 0.025), (i + 0.005, i + 0.005, B))
    mesh_obj("floor", bm, m_floor)
    # glass: lid + 4 walls, centred in the beam depth, tucked 8mm into the frame
    g = bmesh.new()
    e = i + 0.008
    mid = h - B / 2
    t = GLASS_T / 2
    bm_box(g, (-e, -e, S - B / 2 - t), (e, e, S - B / 2 + t))           # lid
    for sx in (-1, 1):
        bm_box(g, (sx * mid - t, -e, B - 0.008), (sx * mid + t, e, S - B + 0.008))
    for sy in (-1, 1):
        bm_box(g, (-e, sy * mid - t, B - 0.008), (e, sy * mid + t, S - B + 0.008))
    mesh_obj("glass", g, m_glass)


def blade_outline():
    """Brass part (blade + shoulder + neck) outline in the key plane, teeth on the -y edge."""
    w = BLADE_W
    xs, xt = X_SHOULDER, X_TIP
    cuts = [(xs + 0.0115 + k * CUT_SPACING, d) for k, d in enumerate(CUT_DEPTHS)]

    def cut_depth(x):
        best = 0.0
        for c, d in cuts:
            best = max(best, d - max(0.0, abs(x - c) - CUT_ROOT / 2))
        return best

    # bottom (toothed) edge from the tip back to the shoulder, sampled then simplified
    x0, x1 = xs, xt - 0.008
    step = 0.00002
    n = int((x1 - x0) / step)
    raw = [(x1 - k * step, -w + cut_depth(x1 - k * step)) for k in range(n + 1)]
    raw[-1] = (x0, -w + cut_depth(x0))
    bottom = [raw[0]]
    for k in range(1, len(raw) - 1):
        (ax, ay), (bx_, by_), (cx, cy) = bottom[-1], raw[k], raw[k + 1]
        if abs((bx_ - ax) * (cy - ay) - (by_ - ay) * (cx - ax)) > 1e-12:
            bottom.append(raw[k])
    bottom.append(raw[-1])
    pts = [(xt - 0.018, w), (xt, w - 0.014), (xt, -w + 0.008)]
    pts += bottom
    sh, nk = 0.031, 0.024
    pts += [(xs, -sh), (xs - 0.028, -sh), (xs - 0.028, -nk), (xs - 0.07, -nk),
            (xs - 0.07, nk), (xs - 0.028, nk), (xs - 0.028, sh), (xs, sh), (xs, w)]
    return [(x, -y) for x, y in pts]          # mirror: teeth on the +y edge


def build_key_and_lock(m_brass_x, m_brass_r, m_enamel, m_steel_r, m_steel_x):
    zk = ZK
    # --- brass blade / shoulder / neck
    bm = bmesh.new()
    pts = [(x + OX, y) for x, y in blade_outline()]
    bm_prism(bm, pts, zk - BLADE_T / 2, zk + BLADE_T / 2)
    blade = mesh_obj("key_brass", bm, m_brass_x)
    gx0, gx1 = X_SHOULDER + 0.006 + OX, X_TIP + 0.02 + OX
    top = zk + BLADE_T / 2
    bot = zk - BLADE_T / 2
    cutters = [
        cutter_box("g1", (gx0, -0.0125, top - 0.0028), (gx1, -0.0065, top + 0.01)),
        cutter_box("g2", (gx0, -0.0005, top - 0.0018), (gx1, 0.0035, top + 0.01)),
        cutter_box("g3", (gx0, -0.0050, bot - 0.01), (gx1, 0.0010, bot + 0.0026)),
    ]
    apply_booleans(blade, cutters)
    smooth(blade)
    bevel(blade, 0.0007, 2)

    # --- enamel head with a hole + brass eyelet
    def inside(x, y):
        return abs((x - (X_HEAD + OX)) / HEAD_A) ** HEAD_N + abs(y / HEAD_B) ** HEAD_N < 1.0

    bm = bmesh.new()
    bm_holed_prism(bm, inside, (HOLE_X + OX, 0.0), HOLE_R, zk - HEAD_T / 2, zk + HEAD_T / 2)
    head = mesh_obj("key_head", bm, m_enamel)
    smooth(head, 25)
    bevel(head, 0.0045, 4, 25)

    z0, z1, f = zk - HEAD_T / 2, zk + HEAD_T / 2, 0.0018
    prof = [(z0 - f, 0.0165), (z0 - f, 0.0262), (z0, 0.0262), (z0, 0.0204), (z1, 0.0204),
            (z1, 0.0262), (z1 + f, 0.0262), (z1 + f, 0.0165)]
    bm = bmesh.new()
    bm_lathe(bm, prof, "Z", (HOLE_X + OX, 0.0, 0.0), 96)
    eyelet = mesh_obj("key_eyelet", bm, m_brass_r)
    smooth(eyelet, 35)
    bevel(eyelet, 0.0005, 2, 35)

    # --- lock cylinder (axis X, through the key plane), brass plug with a keyway
    xf = X_FLANGE + OX
    steel_prof = [(xf, 0.046), (xf, 0.080), (xf + 0.004, 0.084), (OX, 0.084), (OX, 0.068),
                  (OX + 0.07, 0.068), (OX + 0.07, 0.064), (OX + 0.074, 0.064), (OX + 0.074, 0.068),
                  (OX + 0.14, 0.068), (OX + 0.14, 0.064), (OX + 0.144, 0.064), (OX + 0.144, 0.068),
                  (OX + 0.20, 0.068), (OX + 0.20, 0.05), (OX + 0.215, 0.05), (OX + 0.215, 0.0),
                  (xf + 0.022, 0.0), (xf + 0.022, 0.046)]
    bm = bmesh.new()
    bm_lathe(bm, [(a, r) for a, r in steel_prof], "X", (0.0, 0.0, zk), 128)
    body = mesh_obj("lock_body", bm, m_steel_r)
    smooth(body, 35)
    bevel(body, 0.0012, 2, 35)

    plug_prof = [(xf + 0.002, 0.0), (xf + 0.002, 0.0432), (xf + 0.0035, 0.0446), (xf + 0.024, 0.0446),
                 (xf + 0.024, 0.0)]
    bm = bmesh.new()
    bm_lathe(bm, plug_prof, "X", (0.0, 0.0, zk), 128)
    plug = mesh_obj("lock_plug", bm, m_brass_r)
    kw = cutter_box("keyway", (xf - 0.01, -0.0235, zk - 0.0075), (xf + 0.03, 0.0235, zk + 0.0075))
    apply_booleans(plug, [kw])
    smooth(plug, 35)
    bevel(plug, 0.0008, 2, 35)

    # scale the whole key+lock about (0, 0, ZK)
    pivot = Vector((0.0, 0.0, zk))
    mtx = (Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(ROLL), 4, "X")
           @ Matrix.Scale(KS, 4) @ Matrix.Translation(-pivot))
    for ob in (blade, head, eyelet, body, plug):
        ob.matrix_world = mtx

    # --- pedestal (cradle + column + foot) holding the cylinder, built at final scale
    k = KS
    bm = bmesh.new()
    bm_box(bm, (k * (OX + 0.045), -k * 0.05, zk - k * 0.11), (k * (OX + 0.165), k * 0.05, zk - k * 0.060))
    bm_box(bm, (k * (OX + 0.075), -k * 0.026, B), (k * (OX + 0.135), k * 0.026, zk - k * 0.11))
    bm_box(bm, (k * (OX + 0.025), -k * 0.075, B), (k * (OX + 0.185), k * 0.075, B + 0.014))
    ped = mesh_obj("pedestal", bm, m_steel_x)
    smooth(ped)
    bevel(ped, 0.002, 2)
    return blade, head, eyelet


def build_plinth(m_stone, shadow=True):
    bm = bmesh.new()
    h = PL / 2
    bm_box(bm, (-h, -h, -PL_H), (h, h, 0.0))
    ob = mesh_obj("plinth", bm, m_stone)
    smooth(ob)
    bevel(ob, 0.006, 3)
    if shadow:
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=20.0,
                              matrix=Matrix.Translation((0, 0, -PL_H)))
        g = mesh_obj("shadow_catcher", bm, mat_plain("catcher", (0.5, 0.5, 0.5), 0.9))
        g.is_shadow_catcher = True


# ----------------------------------------------------------------------------- camera
# Subject stays CENTRED (inside x 0.2-0.8, y 0.08-0.92); the page shifts the film itself.
# Top-down phase: camera height h above the key plane, log-eased through H0 -> H90 -> H160.
# Yaw: 90deg (key vertical in frame, head up, teeth right) until f90, then a slow turn to
# YAW220 that carries on through the f160-f220 tilt.
H0, H90, H160 = 0.267, 3.30, 4.45
D220, LENS220, TZ220 = 8.0, 70.0, 0.16
DIST_LEAD = 40.0
TILT220 = math.radians(57.0)        # 33deg camera elevation at f220
YAW0, YAW220 = math.radians(90.0), math.radians(28.0)
F_TURN0 = 115
GLASS_TOP = S - B / 2 + GLASS_T / 2
FLOOR_H0, FLOOR_H1 = 1.75, 2.8      # --floor holdout: floor fades in over this camera height


def cam_state(f):
    log_h = [(0, math.log(H0)), (90, math.log(H90)), (160, math.log(H160))]
    psi = lerp(YAW0, YAW220, smootherstep((f - F_TURN0) / (N_FRAMES - 1 - F_TURN0)))
    if f <= 160:
        h = math.exp(pchip(log_h, f))
        T = Vector((0.0, 0.004 * KS * (1 - smootherstep(f / 90.0)), ZK))
        theta = 0.0
        lens, dist = 50.0, h
        focus = h - KS * BLADE_T / 2
    else:
        s = smootherstep((f - 160) / 60.0)
        sd = smootherstep((f - 160) / DIST_LEAD)   # pull back/retarget a bit ahead of the tilt
        theta = TILT220 * s
        T = Vector((0.0, 0.0, ZK)).lerp(Vector((0.0, 0.0, TZ220)), sd)
        lens = lerp(50.0, LENS220, s)
        dist = math.exp(lerp(math.log(H160), math.log(D220), sd))
        focus = dist
    fwd = Matrix.Rotation(psi, 3, "Z") @ Vector((0.0, math.sin(theta), -math.cos(theta)))
    loc = T - fwd * dist
    fstop = math.exp(lerp(math.log(16.0), math.log(400.0), smoothstep(f / 55.0)))
    fade = smoothstep((loc.z - (GLASS_TOP + 0.01)) / 0.35)
    return dict(loc=loc, rot=(theta, 0.0, psi), lens=lens, shift=0.0, focus=focus,
                fstop=fstop, fade=fade, h=loc.z - ZK)


def build_camera(fade_socket, floor_fade_socket=None):
    cd = bpy.data.cameras.new("cam")
    cd.sensor_fit = "HORIZONTAL"
    cd.sensor_width = 36.0
    cd.clip_start = 0.003
    cd.clip_end = 200.0
    cd.dof.use_dof = True
    cam = link(bpy.data.objects.new("cam", cd))
    cam.rotation_mode = "XYZ"
    bpy.context.scene.camera = cam
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    for f in range(N_FRAMES):
        st = cam_state(f)
        cam.location = st["loc"]
        cam.rotation_euler = st["rot"]
        cd.lens = st["lens"]
        cd.shift_x = st["shift"]
        cd.dof.focus_distance = st["focus"]
        cd.dof.aperture_fstop = st["fstop"]
        fade_socket.default_value = st["fade"]
        cam.keyframe_insert("location", frame=f)
        cam.keyframe_insert("rotation_euler", frame=f)
        cd.keyframe_insert("lens", frame=f)
        cd.keyframe_insert("shift_x", frame=f)
        cd.dof.keyframe_insert("focus_distance", frame=f)
        cd.dof.keyframe_insert("aperture_fstop", frame=f)
        fade_socket.keyframe_insert("default_value", frame=f)
        if floor_fade_socket is not None:
            floor_fade_socket.default_value = smoothstep((st["h"] - FLOOR_H0) / (FLOOR_H1 - FLOOR_H0))
            floor_fade_socket.keyframe_insert("default_value", frame=f)
    return cam


# ----------------------------------------------------------------------------- render setup
def setup_render(args):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    cy = sc.cycles
    if not args.cpu:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        try:
            prefs.refresh_devices()
        except Exception:
            prefs.get_devices()
        used = []
        for d in prefs.devices:
            d.use = d.type == "METAL"
            if d.use:
                used.append(d.name)
        print("[vault] devices:", used, flush=True)
        cy.device = "GPU" if used else "CPU"
    else:
        cy.device = "CPU"
    cy.samples = args.samples
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = args.noise
    cy.use_denoising = True
    cy.denoiser = "OPENIMAGEDENOISE"
    cy.denoising_input_passes = "RGB_ALBEDO_NORMAL"
    cy.denoising_prefilter = "ACCURATE"
    try:
        cy.denoising_use_gpu = not args.cpu
    except Exception:
        pass
    cy.max_bounces = 12
    cy.diffuse_bounces = 3
    cy.glossy_bounces = 6
    cy.transmission_bounces = 12
    cy.transparent_max_bounces = 24
    cy.volume_bounces = 0
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.blur_glossy = 0.5
    cy.sample_clamp_indirect = 4.0
    cy.seed = 0
    cy.use_animated_seed = False
    cy.film_transparent_glass = True
    cy.film_transparent_roughness = 0.1
    r = sc.render
    r.film_transparent = True
    r.resolution_x, r.resolution_y, r.resolution_percentage = W, H, args.pct
    r.use_persistent_data = True
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGBA"
    r.image_settings.color_depth = "8"
    r.image_settings.compression = 15
    sc.frame_start, sc.frame_end = 0, N_FRAMES - 1
    vs = sc.view_settings
    try:
        vs.view_transform = "Khronos PBR Neutral"
    except TypeError:
        vs.view_transform = "AgX"
    vs.look = "None"
    vs.exposure = EXPOSURE if args.exposure is None else args.exposure
    vs.gamma = 1.0


def projected_rect(objs, frame, keep=None):
    sc = bpy.context.scene
    sc.frame_set(frame)
    dg = bpy.context.evaluated_depsgraph_get()
    cam = sc.camera.evaluated_get(dg)
    xs, ys = [], []
    for ob in objs:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ev.matrix_world
        for v in me.vertices:
            wco = mw @ v.co
            if keep is not None and not keep(wco):
                continue
            p = world_to_camera_view(sc, cam, wco)
            if p.z > 0:
                xs.append(p.x)
                ys.append(1.0 - p.y)
        ev.to_mesh_clear()
    raw = [min(xs), min(ys), max(xs), max(ys)]
    c = [clamp01(raw[0]), clamp01(raw[1]), clamp01(raw[2]), clamp01(raw[3])]
    r4 = lambda v: round(v, 4)
    return {"x": r4(c[0]), "y": r4(c[1]), "w": r4(c[2] - c[0]), "h": r4(c[3] - c[1]),
            "unclipped": [r4(v) for v in raw]}


def _bbox_px(objs, cam, dg):
    sc = bpy.context.scene
    xs, ys, behind = [], [], False
    for ob in objs:
        ev = ob.evaluated_get(dg)
        for c in ev.bound_box:
            p = world_to_camera_view(sc, cam, ev.matrix_world @ Vector(c))
            if p.z <= 0:
                behind = True
                continue
            xs.append(p.x)
            ys.append(1.0 - p.y)
    return behind, (min(xs), min(ys), max(xs), max(ys)) if xs else None


def safe_area_report(blade, head):
    sc = bpy.context.scene
    names = ("frame_x", "frame_y", "frame_z", "glass", "plinth")
    vault = [bpy.data.objects[n] for n in names]
    lock = [bpy.data.objects[n] for n in ("lock_body", "lock_plug", "key_eyelet")]
    print("[report] f  cam_h  vault+plinth(x0 y0 x1 y1)  key+lock(x0 y0 x1 y1)  inside")
    for f in range(N_FRAMES):
        sc.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        cam = sc.camera.evaluated_get(dg)
        loc = cam.matrix_world.translation
        inside = abs(loc.x) < S / 2 and abs(loc.y) < S / 2 and loc.z < S
        _, vb = _bbox_px(vault, cam, dg)
        _, kb = _bbox_px([blade, head] + lock, cam, dg)
        fmt = lambda b: " ".join(f"{v:6.3f}" for v in b) if b else "-"
        print(f"[report] {f:3d} {loc.z - ZK:6.3f}  {fmt(vb) if not inside else 'camera inside vault':>30}  {fmt(kb)}  {int(inside)}")


# ----------------------------------------------------------------------------- main
def main():
    args = parse_args()
    for kv in args.set:
        k, v = kv.split("=", 1)
        globals()[k] = float(v) if not k.startswith(("YAW", "TILT")) else math.radians(float(v))
    bpy.ops.wm.read_factory_settings(use_empty=True)

    steel = (0.56, 0.565, 0.57)
    brass = (0.80, 0.60, 0.30)
    m_steel_x = mat_brushed("steel_x", steel, 0.24, 0.75, "X", streak=900.0)
    m_steel_y = mat_brushed("steel_y", steel, 0.24, 0.75, "Y", streak=900.0)
    m_steel_z = mat_brushed("steel_z", steel, 0.24, 0.75, "Z", streak=900.0)
    m_steel_r = mat_brushed("steel_turned", steel, 0.22, 0.7, "RX", streak=1500.0)
    if args.floor == "stone":
        m_floor = mat_stone("floor_stone", (0.74, 0.725, 0.69), (0.80, 0.785, 0.75), rough=0.75)
    elif args.floor == "catcher":
        m_floor = mat_plain("floor_catcher", (0.8, 0.79, 0.76), 0.8)
    else:
        m_floor = mat_brushed("gunmetal", (0.11, 0.11, 0.115), 0.34, 0.5, "X", streak=700.0, rvar=0.025, bump=0.003)
    floor_fade = holdout_for_camera(m_floor) if args.floor == "holdout" else None
    m_brass_x = mat_brushed("brass_x", brass, 0.24, 0.6, "X", streak=3500.0, bump=0.004)
    m_brass_rx = mat_brushed("brass_turned_x", brass, 0.22, 0.6, "RX", streak=2500.0, bump=0.004)
    m_brass_rz = mat_brushed("brass_turned_z", brass, 0.22, 0.6, "RZ", streak=2500.0, bump=0.004)
    m_enamel = mat_enamel("canary_enamel", CANARY)
    m_glass, fade = mat_glass("smoked_glass")
    m_stone = mat_stone("stone")

    build_world()
    build_lights()
    build_plinth(m_stone, shadow=True)
    build_vault(m_steel_x, m_steel_y, m_steel_z, m_glass, m_floor)
    blade, head, eyelet = build_key_and_lock(m_brass_x, m_brass_rz, m_enamel, m_steel_r, m_steel_x)
    bpy.data.objects["lock_plug"].data.materials[0] = m_brass_rx
    if args.floor == "catcher":
        bpy.data.objects["floor"].is_shadow_catcher = True
    cam = build_camera(fade.outputs[0], floor_fade.outputs[0] if floor_fade else None)
    setup_render(args)
    if args.report:
        safe_area_report(blade, head)

    if args.meta:
        meta = {
            "frames": N_FRAMES, "width": W, "height": H,
            "rect_origin": "top-left, normalized 0..1 (x right, y down)",
            # exposed toothed blade between the shoulder and the lock flange (the f0 subject)
            "f000_key_blade": projected_rect(
                [blade], 0, keep=lambda co: KS * (X_SHOULDER + OX) + 1e-4 < co.x <= KS * (X_FLANGE + OX)),
            "f090_key": projected_rect([blade, head, eyelet], 90),
            "f160_vault_plinth": projected_rect([bpy.data.objects[n] for n in ("frame_x", "plinth")], 160),
            "f220_vault_plinth": projected_rect([bpy.data.objects[n] for n in ("frame_x", "plinth")], 220),
            "glass_lid_crossing_frame": next(f for f in range(N_FRAMES) if cam_state(f)["loc"].z > GLASS_TOP),
        }
        os.makedirs(os.path.dirname(os.path.abspath(args.meta)), exist_ok=True)
        with open(args.meta, "w") as fh:
            json.dump(meta, fh, indent=2)
        print("[vault] meta:", json.dumps(meta), flush=True)

    if args.save:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.save), compress=True)

    if args.no_render:
        return

    if args.frames:
        frames = [int(x) for x in args.frames.split(",") if x.strip()]
    elif args.range:
        a, b = (int(x) for x in args.range.split("-"))
        frames = list(range(a, b + 1))
    else:
        frames = list(range(N_FRAMES))

    os.makedirs(args.out, exist_ok=True)
    sc = bpy.context.scene
    log = open(os.path.join(args.out, "timing.tsv"), "a")
    t_all = time.time()
    done = 0
    for f in frames:
        path = os.path.join(args.out, f"f{f:03d}.png")
        if os.path.exists(path) and not args.overwrite:
            print(f"[vault] skip f{f:03d} (exists)", flush=True)
            continue
        sc.frame_set(f)
        sc.render.filepath = path
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        dt = time.time() - t0
        done += 1
        log.write(f"{f}\t{dt:.1f}\t{args.pct}\t{args.samples}\t{args.noise}\n")
        log.flush()
        print(f"[vault] frame f{f:03d} rendered in {dt:.1f}s  ({done}/{len(frames)})", flush=True)
    log.close()
    print(f"[vault] done: {done} frames in {time.time() - t_all:.0f}s", flush=True)


if __name__ == "__main__":
    main()
