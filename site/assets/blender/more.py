"""
Canary Court - lower-section pieces (procedural, Blender 5.2 / Cycles), same language as how.py.

  P1 Receipts            a brass receipt spindle on a stone base, blank receipts pierced on it, some wax-sealed
  P2 Five ways to steal  the vault + key with five calm "failed attempts" around it on the plinth
  P3 Public vs sealed    a clear glass box holding a verdict card beside a closed steel box sealed in canary wax
  P4 Close               the vault + key on its plinth, a slow 360 turntable

P1-P3: 48 frames, eased ~35 deg orbit (f0 = rest pose). P4: 72 frames, linear 360 (seamless loop).
1200x900, subject centred at ~70% of the frame height over the whole orbit, inside x 0.1-0.9.

  nice -n 10 /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
      -P site/assets/blender/more.py -- --pieces 1,2,3,4 [--frames 0] [--pct 50 --samples 96]
"""

import argparse
import math
import os
import sys
import time
from types import SimpleNamespace

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import how as H  # noqa: E402
import vault as V  # noqa: E402

W, HH = 1200, 900


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="more.py")
    p.add_argument("--pieces", default="1,2,3,4")
    p.add_argument("--frames", default="all")
    p.add_argument("--out", default=os.path.join(HERE, ".render", "more"))
    p.add_argument("--samples", type=int, default=512)
    p.add_argument("--noise", type=float, default=0.01)
    p.add_argument("--pct", type=int, default=100)
    p.add_argument("--overwrite", action="store_true")
    p.add_argument("--cpu", action="store_true")
    p.add_argument("--save", default="")
    return p.parse_args(argv)


# ----------------------------------------------------------------------------- parts
def mat_paper(name):
    m, nt, out = V.new_mat(name)
    b = V.principled(nt, base=(0.60, 0.585, 0.545), rough=0.75, spec=0.3)
    nt.links.new(b.outputs[0], out.inputs["Surface"])
    return m


def box_obj(name, lo, hi, m, bev=0.006):
    bm = bmesh.new()
    V.bm_box(bm, lo, hi)
    ob = V.mesh_obj(name, bm, m)
    V.smooth(ob)
    V.bevel(ob, bev, 3)
    return ob


def thin_rect(name, w, h, t, m, rr=None):
    bm = bmesh.new()
    V.bm_prism(bm, H.rounded_rect(w, h, rr if rr is not None else min(w, h) * 0.04), -t / 2, t / 2)
    ob = V.mesh_obj(name, bm, m)
    V.smooth(ob)
    V.bevel(ob, t * 0.3, 1)
    return ob


def place(ob, loc, rot=(0.0, 0.0, 0.0), scale=1.0):
    ob.matrix_world = (Matrix.Translation(loc) @ Matrix.Rotation(rot[2], 4, "Z") @ Matrix.Rotation(rot[1], 4, "Y")
                       @ Matrix.Rotation(rot[0], 4, "X") @ Matrix.Scale(scale, 4))
    return ob


def seal_on(parent, m, r, uv, z, seed=1.0):
    s = H.wax_seal(f"{parent.name}_seal", m, R=r, h=r * 0.22, seed=seed)
    s.parent = parent
    s.location = (uv[0], uv[1], z)
    return s


def simple_key(name, m_head, m_blade, square_teeth=True):
    """A plain flat key (local XY plane, blade along +x): disc head with a hole, a blade with teeth."""
    # head: holed disc
    bm = bmesh.new()
    V.bm_holed_prism(bm, lambda x, y: math.hypot(x, y) < 0.085, (-0.035, 0.0), 0.018, -0.011, 0.011, segs=96)
    head = V.mesh_obj(name + "_head", bm, m_head)
    V.smooth(head, 25)
    V.bevel(head, 0.004, 3, 25)
    # blade with crude square notches (the counterfeit's wrong bitting)
    pts = [(0.07, 0.02), (0.36, 0.02), (0.38, 0.0)]
    x = 0.36
    cuts = [(0.32, 0.017), (0.25, 0.017), (0.18, 0.017), (0.11, 0.017)]
    bottom = [(0.38, -0.004), (0.36, -0.02)]
    for cx, dpt in cuts:
        bottom += [(cx + 0.018, -0.02), (cx + 0.018, -0.02 + dpt), (cx - 0.018, -0.02 + dpt), (cx - 0.018, -0.02)]
    bottom += [(0.07, -0.02)]
    bm = bmesh.new()
    V.bm_prism(bm, pts + bottom, -0.006, 0.006)
    blade = V.mesh_obj(name + "_blade", bm, m_blade)
    V.smooth(blade)
    V.bevel(blade, 0.0012, 2)
    blade.parent = head
    return head


# ----------------------------------------------------------------------------- pieces
def p1(m):
    """Receipts: a brass spindle on a stone base with blank receipts pierced on it, three wax-sealed."""
    H.shadow_catcher(0.0)
    box_obj("spindle_base", (-0.17, -0.17, 0.0), (0.17, 0.17, 0.07), m.stone, 0.012)
    H.rod("spike", m.brass_x, (0, 0, 0.065), (0, 0, 0.46), r=0.0075)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=32, radius1=0.0075, radius2=0.0, depth=0.05,
                          matrix=Matrix.Translation((0, 0, 0.485)))
    tip = V.mesh_obj("spike_tip", bm, m.brass_x)
    for p in tip.data.polygons:
        p.use_smooth = True
    H.ball("spike_collar", m.brass_x, (0, 0, 0.073), 0.016)
    paper = mat_paper("receipt_paper")
    n = 20
    sealed = {5: 0.6, 12: 2.2, 19: 3.7}
    for i in range(n):
        j = math.sin(i * 12.9898 + 1.7) * 43758.5453
        r = j - math.floor(j)
        rot_z = math.radians(-50 + 100 * r)
        tilt = math.radians(3.5 * math.sin(i * 2.3))
        rc = thin_rect(f"receipt_{i:02d}", 0.15, 0.27, 0.0025, paper, 0.004)
        # pierced 0.075 from one end: the slip's centre sits off the spike along its length
        off = Matrix.Translation((0.0, 0.06, 0.0))
        rc.matrix_world = (Matrix.Translation((0, 0, 0.083 + i * 0.0105)) @ Matrix.Rotation(rot_z, 4, "Z")
                           @ Matrix.Rotation(tilt, 4, "X") @ off)
        if i in sealed:
            seal_on(rc, m.wax, 0.022, (0.0, 0.07), 0.00125, sealed[i])
    return dict(theta=60.0, yaw0=-12.0, lens=70.0, frames=48, orbit=35.0, ease=True)


def p2(m):
    """Five ways to steal, none work: the vault + key, five calm failed attempts spaced around it on the plinth
    (front-left key, front-right pawn, left replay pair, right sealed note, back-right toppled coins)."""
    H.vault_scene(m, plinth=2.6, plinth_h=0.32)
    me = H.coin_mesh(R=0.085 * 2.2, T=0.013 * 2.2)
    k = 2.4
    # front-left: counterfeit key, its blade crenellated with big square notches (clearly not real bitting)
    key = simple_key("counterfeit", m.satin_x, m.coin)
    place(key, (-1.00, -0.80, 0.011 * k), (0, 0, math.radians(-18)), k)
    # front-right: a steel pawn knocked over
    pw = H.pawn("fallen_pawn", m.polished, 1.65, (0, 0, 0))
    place(pw, (0.74, -0.86, 0.105 * 1.65), (math.radians(90), 0, math.radians(-62)))
    # left: a duplicated card pair (replay)
    for i in range(2):
        c = H.sealed_card(f"replay_{i}", 0.49, 0.34, 0.008, m.card, m.wax, 0.04, seal_uv=(-0.14, 0.06))
        place(c, (-1.00 + 0.08 * i, 0.22 + 0.08 * i, 0.004 + 0.0085 * i), (0, 0, math.radians(76)))
    # right: a note card sealed and addressed to the judge (wax dot)
    card = H.sealed_card("judge_note", 0.51, 0.35, 0.008, m.card, m.wax, 0.045, seal_uv=(0.14, -0.06))
    place(card, (0.98, -0.12, 0.004), (0, 0, math.radians(78)))
    # back-right: a toppled coin stack (runaway spend), its coins slid along the plinth
    for i in range(7):
        a = math.radians(12)
        p = Vector((0.50 + 0.13 * i * math.cos(a), 0.86 + 0.13 * i * math.sin(a), 0.045 + 0.005 * i))
        H.coin(me, m.coin, p, (math.radians(-14), 0.0, a + 0.4 * i), f"toppled_{i}")
    return dict(theta=60.0, yaw0=-17.5, lens=70.0, frames=48, orbit=35.0, ease=True)


def p3(m):
    """Public vs sealed: a clear glass box holding a verdict card, beside a closed steel box in canary wax."""
    H.slab("slab", 1.36, 0.80, 0.08, m.stone)
    H.shadow_catcher(-0.08)
    # clear glass box: the vault's frame + glass, smaller and with a clear (not smoked) glass
    V.SMOKE, smoke = (0.95, 0.95, 0.948), V.SMOKE
    clear, _ = V.mat_glass("clear_glass")
    V.SMOKE = smoke
    before = set(bpy.data.objects)
    V.build_vault(m.steel_x, m.steel_y, m.steel_z, clear, m.gunmetal)
    gs = 0.5
    for ob in set(bpy.data.objects) - before:
        ob.matrix_world = Matrix.Translation((-0.34, 0.0, 0.0)) @ Matrix.Scale(gs, 4) @ ob.matrix_world
    # the verdict card inside, upright on a little steel foot, facing the camera
    card = thin_rect("verdict_card", 0.26, 0.19, 0.005, m.card)
    place(card, (-0.34, 0.02, 0.03 + 0.095 + 0.02), (math.radians(90), 0, 0))
    box_obj("card_foot", (-0.34 - 0.07, -0.01, 0.03), (-0.34 + 0.07, 0.05, 0.05), m.steel_x, 0.004)
    # the sealed steel box: body + lid with a seam, canary wax across the seam on the front
    bx, s = 0.34, 0.25
    box_obj("sealed_body", (bx - s, -s, 0.0), (bx + s, s, 0.38), m.satin_z, 0.008)
    box_obj("sealed_lid", (bx - s, -s, 0.386), (bx + s, s, 0.47), m.satin_x, 0.008)
    seal = H.wax_seal("sealed_box_seal", m.wax, R=0.05, h=0.011, seed=2.0)
    place(seal, (bx, -s - 0.0005, 0.383), (math.radians(90), 0, 0))
    return dict(theta=60.0, yaw0=-12.0, lens=70.0, frames=48, orbit=35.0, ease=True)


def p4(m):
    """Close: the vault + key on its plinth, a slow 360."""
    H.vault_scene(m)
    return dict(theta=60.0, yaw0=20.0, lens=70.0, frames=72, orbit=360.0, ease=False)


PIECES = {1: p1, 2: p2, 3: p3, 4: p4}


# ----------------------------------------------------------------------------- camera
def yaw_fn(spec):
    nf = spec["frames"]
    if spec["ease"]:
        return lambda f: math.radians(spec["yaw0"] + spec["orbit"] * V.smoothstep(f / (nf - 1)))
    return lambda f: math.radians(spec["yaw0"] + spec["orbit"] * f / nf)      # loops: f = nf would equal f = 0


def build_camera(spec):
    sc = bpy.context.scene
    cd = bpy.data.cameras.new("cam")
    cd.sensor_fit = "HORIZONTAL"
    cd.sensor_width = H.SENSOR_W
    cd.lens = spec["lens"]
    cd.clip_start, cd.clip_end = 0.01, 100.0
    cam = V.link(bpy.data.objects.new("cam", cd))
    cam.rotation_mode = "XYZ"
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = W, HH
    objs = H.subject_objects()
    dg = bpy.context.evaluated_depsgraph_get()
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for ob in objs:
        ev = ob.evaluated_get(dg)
        for c in ev.bound_box:
            p = ev.matrix_world @ Vector(c)
            lo, hi = Vector(map(min, lo, p)), Vector(map(max, hi, p))
    T = (lo + hi) / 2
    theta = math.radians(spec["theta"])
    yaw = yaw_fn(spec)
    nf = spec["frames"]
    samples = [0, nf // 4, nf // 2, 3 * nf // 4, nf - 1] if spec["ease"] else list(range(0, nf, nf // 12))
    dist = 4.0
    frame_h = H.SENSOR_W * HH / W / spec["lens"]
    for _ in range(6):
        b = [1e9, 1e9, -1e9, -1e9]
        for f in samples:
            H.pose(cam, T, dist, theta, yaw(f))
            bpy.context.view_layer.update()
            dg = bpy.context.evaluated_depsgraph_get()
            x0, y0, x1, y1 = H.project_bounds(objs, cam, sc, dg)
            b = [min(b[0], x0), min(b[1], y0), max(b[2], x1), max(b[3], y1)]
        cy, cx = (b[1] + b[3]) / 2 - 0.5, (b[0] + b[2]) / 2 - 0.5
        psi_mid = yaw(nf // 2) if spec["ease"] else 0.0
        up = Matrix.Rotation(psi_mid, 3, "Z") @ Vector((0.0, math.cos(theta), math.sin(theta)))
        right = Matrix.Rotation(psi_mid, 3, "Z") @ Vector((1.0, 0.0, 0.0))
        T = T - up * (cy * frame_h * dist)
        if spec["ease"]:
            T = T + right * (cx * frame_h * dist * W / HH)
        dist *= max((b[3] - b[1]) / H.FILL, (b[2] - b[0]) / 0.78)
    spec["bounds"], spec["dist"] = b, dist
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    for f in range(nf):
        H.pose(cam, T, dist, theta, yaw(f))
        cam.keyframe_insert("location", frame=f)
        cam.keyframe_insert("rotation_euler", frame=f)
    return cam


def main():
    args = parse_args()
    for piece in [int(s) for s in args.pieces.split(",") if s.strip()]:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        m = H.materials()
        V.WORLD_BLOB = H.WORLD_BLOB
        V.build_world()
        V.build_lights()
        H.relight()
        spec = PIECES[piece](m)
        V.setup_render(SimpleNamespace(cpu=args.cpu, samples=args.samples, noise=args.noise, pct=args.pct,
                                       exposure=None))
        sc = bpy.context.scene
        build_camera(spec)
        sc.render.resolution_x, sc.render.resolution_y = W, HH
        sc.frame_start, sc.frame_end = 0, spec["frames"] - 1
        print(f"[more] p{piece}: dist {spec['dist']:.2f}, union bounds " + " ".join(f"{v:.3f}" for v in spec["bounds"]),
              flush=True)
        if args.save:
            os.makedirs(args.save, exist_ok=True)
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.abspath(args.save), f"p{piece}.blend"),
                                        compress=True)
        frames = list(range(spec["frames"])) if args.frames == "all" else [int(x) for x in args.frames.split(",")]
        out = os.path.join(args.out, f"p{piece}")
        os.makedirs(out, exist_ok=True)
        t_all, done = time.time(), 0
        for f in frames:
            path = os.path.join(out, f"f{f:03d}.png")
            if os.path.exists(path) and not args.overwrite:
                continue
            sc.frame_set(f)
            sc.render.filepath = path
            t0 = time.time()
            bpy.ops.render.render(write_still=True)
            done += 1
            print(f"[more] p{piece} f{f:03d} rendered in {time.time() - t0:.1f}s ({done}/{len(frames)})", flush=True)
        print(f"[more] p{piece} done: {done} frames in {time.time() - t_all:.0f}s", flush=True)


if __name__ == "__main__":
    main()
