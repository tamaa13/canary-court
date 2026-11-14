"""
Canary Court - "How it works" step turntables (procedural, Blender 5.2 / Cycles).

Same visual language as vault.py (it imports its materials, lights, world and the vault/key
builders): brushed steel, smoked neutral glass, matte canary enamel, brushed brass, warm-grey
matte stone, soft studio light, transparent film.

One composition per step, each a 48-frame turntable (~35 deg eased orbit, f0 = rest pose),
1200x900, subject centred and filling ~70% of the frame height over the whole orbit.

  nice -n 10 /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
      -P site/assets/blender/how.py -- --steps 1,2,3,4,5 --frames 0

Options (after "--"):
  --steps 1,2,3,4,5   which steps (default all)
  --frames 0 | 0-47   which frames (default 0-47)
  --out DIR           PNG root, frames go to DIR/stepN/fNNN.png (default .render/how)
  --samples N / --noise T / --pct P / --overwrite / --cpu   as in vault.py
  --report            print the projected subject bounds at f0 / mid / end
  --save DIR          also save stepN.blend files there
"""

import argparse
import math
import os
import sys
import time
from types import SimpleNamespace

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import vault as V  # noqa: E402  (materials, lights, world, vault + key builders)

W, H = 1200, 900
N_FRAMES = 48
ORBIT = 35.0                  # degrees, eased, f0 = rest pose
RIM_ENERGY = 140.0
WORLD_BLOB = 0.3              # vault.py uses 0.8; flat up-facing steel here would mirror it white
FILL = 0.70                   # subject height as a fraction of the frame (max over the orbit)
SENSOR_W = 36.0
STEP_NAMES = {
    1: "The owner posts a bounty",
    2: "Agents bid, negotiate and hire",
    3: "Every attack is one sealed message",
    4: "A TEE runs it and checks for the key",
    5: "Paid in the same step, or not at all",
}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="how.py")
    p.add_argument("--steps", default="1,2,3,4,5")
    p.add_argument("--frames", default=f"0-{N_FRAMES - 1}")
    p.add_argument("--out", default=os.path.join(HERE, ".render", "how"))
    p.add_argument("--samples", type=int, default=512)
    p.add_argument("--noise", type=float, default=0.01)
    p.add_argument("--pct", type=int, default=100)
    p.add_argument("--overwrite", action="store_true")
    p.add_argument("--cpu", action="store_true")
    p.add_argument("--report", action="store_true")
    p.add_argument("--save", default="")
    return p.parse_args(argv)


# ----------------------------------------------------------------------------- materials
def materials():
    steel = (0.56, 0.565, 0.57)
    brass = (0.80, 0.60, 0.30)
    m = SimpleNamespace()
    m.steel_x = V.mat_brushed("steel_x", steel, 0.24, 0.75, "X", streak=900.0)
    m.steel_y = V.mat_brushed("steel_y", steel, 0.24, 0.75, "Y", streak=900.0)
    m.steel_z = V.mat_brushed("steel_z", steel, 0.24, 0.75, "Z", streak=900.0)
    m.steel_rx = V.mat_brushed("steel_turned", steel, 0.22, 0.7, "RX", streak=1500.0)
    m.polished = V.mat_brushed("polished_steel", (0.62, 0.62, 0.63), 0.07, 0.0, "RZ", streak=1500.0,
                               rvar=0.015, bump=0.0)
    m.gunmetal = V.mat_brushed("gunmetal", (0.11, 0.11, 0.115), 0.34, 0.5, "X", streak=700.0,
                               rvar=0.025, bump=0.003)
    m.brass_x = V.mat_brushed("brass_x", brass, 0.24, 0.6, "X", streak=3500.0, bump=0.004)
    m.brass_rx = V.mat_brushed("brass_turned_x", brass, 0.22, 0.6, "RX", streak=2500.0, bump=0.004)
    m.brass_rz = V.mat_brushed("brass_turned_z", brass, 0.22, 0.6, "RZ", streak=2500.0, bump=0.004)
    # satin variants for big flat up-facing parts (escrow box, chip) so they don't mirror the rim light white
    m.satin_x = V.mat_brushed("satin_steel_x", steel, 0.36, 0.5, "X", streak=700.0, rvar=0.05)
    m.satin_z = V.mat_brushed("satin_steel_z", steel, 0.36, 0.5, "Z", streak=700.0, rvar=0.05)
    # coins: a muted brushed brass (less saturated than the key bit) so they never fight the canary
    m.coin = V.mat_brushed("coin_brass", (0.76, 0.60, 0.365), 0.31, 0.5, "RZ", streak=2500.0, bump=0.004)
    m.enamel = V.mat_enamel("canary_enamel", V.CANARY)
    m.wax = mat_wax("canary_wax")
    m.card = mat_card("card")
    m.stone = V.mat_stone("stone")
    m.glass, _ = V.mat_glass("smoked_glass")
    return m


def mat_wax(name):
    """Canary sealing wax: same hue as the enamel, a touch more sheen."""
    mat, nt, out = V.new_mat(name)
    L = nt.links.new
    tc = V.node(nt, "ShaderNodeTexCoord")
    nz = V.node(nt, "ShaderNodeTexNoise")
    V.setv(nz, "Scale", 60.0)
    V.setv(nz, "Detail", 6.0)
    L(tc.outputs["Object"], nz.inputs["Vector"])
    b = V.principled(nt, base=V.CANARY, rough=0.34, spec=0.5)
    mr = V.node(nt, "ShaderNodeMapRange")
    L(nz.outputs["Fac"], mr.inputs["Value"])
    mr.inputs["To Min"].default_value = 0.26
    mr.inputs["To Max"].default_value = 0.42
    L(mr.outputs["Result"], V.sock(b, "Roughness"))
    bp = V.node(nt, "ShaderNodeBump")
    V.setv(bp, "Strength", 0.08)
    V.setv(bp, "Distance", 0.0015)
    L(nz.outputs["Fac"], V.sock(bp, "Height"))
    L(bp.outputs["Normal"], V.sock(b, "Normal"))
    L(b.outputs[0], out.inputs["Surface"])
    return mat


def mat_card(name):
    """Heavy matte card in a light warm grey (reads on paper and on night)."""
    mat, nt, out = V.new_mat(name)
    L = nt.links.new
    tc = V.node(nt, "ShaderNodeTexCoord")
    nz = V.node(nt, "ShaderNodeTexNoise")
    V.setv(nz, "Scale", 400.0)
    V.setv(nz, "Detail", 4.0)
    L(tc.outputs["Object"], nz.inputs["Vector"])
    b = V.principled(nt, base=(0.46, 0.44, 0.405), rough=0.7, spec=0.35)
    bp = V.node(nt, "ShaderNodeBump")
    V.setv(bp, "Strength", 0.03)
    V.setv(bp, "Distance", 0.0005)
    L(nz.outputs["Fac"], V.sock(bp, "Height"))
    L(bp.outputs["Normal"], V.sock(b, "Normal"))
    L(b.outputs[0], out.inputs["Surface"])
    return mat


# ----------------------------------------------------------------------------- parts
def rounded_rect(w, h, r, n=10):
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90),
                       (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def slab(name, w, d, h, m):
    bm = bmesh.new()
    V.bm_box(bm, (-w / 2, -d / 2, -h), (w / 2, d / 2, 0.0))
    ob = V.mesh_obj(name, bm, m)
    V.smooth(ob)
    V.bevel(ob, 0.006, 3)
    return ob


def shadow_catcher(z):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=20.0, matrix=Matrix.Translation((0, 0, z)))
    g = V.mesh_obj("shadow_catcher", bm, V.mat_plain("catcher", (0.5, 0.5, 0.5), 0.9))
    g.is_shadow_catcher = True
    return g


def wax_seal(name, m, R=0.04, h=0.009, seed=0.0):
    """Lathe-built wax blob with a wobbly rim and a pressed (plain, no emblem) centre."""
    prof = [(0.0, 0.0), (0.0, R), (h * 0.45, R * 1.04), (h * 0.85, R * 0.96), (h, R * 0.82),
            (h, R * 0.66), (h * 0.62, R * 0.6), (h * 0.62, 0.0)]
    bm = bmesh.new()
    V.bm_lathe(bm, prof, "Z", (0, 0, 0), 128)
    for v in bm.verts:                       # irregular rim
        r = math.hypot(v.co.x, v.co.y)
        if r > R * 0.5:
            a = math.atan2(v.co.y, v.co.x)
            k = 1 + 0.07 * math.sin(3 * a + seed) + 0.04 * math.sin(7 * a + 2 * seed) + 0.025 * math.sin(13 * a)
            v.co.x *= k
            v.co.y *= k
    ob = V.mesh_obj(name, bm, m)
    V.smooth(ob, 50)
    return ob


def sealed_card(name, w, h, t, m_card, m_wax, seal_r, seal_uv=(0.0, 0.0)):
    """Card in its local XY plane (face normal +Z), seal on the +Z face at seal_uv."""
    bm = bmesh.new()
    V.bm_prism(bm, rounded_rect(w, h, min(w, h) * 0.06), -t / 2, t / 2)
    card = V.mesh_obj(name, bm, m_card)
    V.smooth(card)
    V.bevel(card, t * 0.25, 2)
    seal = wax_seal(name + "_seal", m_wax, R=seal_r, h=seal_r * 0.22, seed=len(name))
    seal.parent = card
    seal.location = (seal_uv[0], seal_uv[1], t / 2 - 0.0005)
    return card


def coin_mesh(R=0.085, T=0.013):
    prof = [(0.0015, 0.0), (0.0015, R - 0.014), (0.0, R - 0.012), (0.0, R - 0.002), (0.002, R),
            (T - 0.002, R), (T, R - 0.002), (T, R - 0.012), (T - 0.0015, R - 0.014), (T - 0.0015, 0.0)]
    bm = bmesh.new()
    V.bm_lathe(bm, prof, "Z", (0, 0, 0), 128)
    me = bpy.data.meshes.new("coin")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(35))
    return me


def coin(me, m, loc, rot=(0.0, 0.0, 0.0), name="coin"):
    ob = V.link(bpy.data.objects.new(name, me))
    if not me.materials:
        me.materials.append(m)
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def coin_stack(me, m, base, n, T=0.013, seed=1.0, name="stack"):
    obs = []
    for i in range(n):
        j = math.sin(seed * 12.9898 + i * 78.233) * 43758.5453
        jx = (j - math.floor(j) - 0.5) * 0.006
        jy = (math.sin(i * 3.1 + seed) * 0.5) * 0.006
        obs.append(coin(me, m, (base[0] + jx, base[1] + jy, base[2] + i * T),
                        (0.0, 0.0, i * 0.7 + seed), f"{name}_{i}"))
    return obs


def pawn(name, m, scale, loc):
    """Abstract agent token: disc base, tapered body, collar, ball head (height ~0.33*scale)."""
    prof = [(0.0, 0.0), (0.0, 0.100), (0.006, 0.105), (0.024, 0.105), (0.030, 0.099), (0.036, 0.076),
            (0.050, 0.062), (0.170, 0.042), (0.176, 0.052), (0.200, 0.052), (0.206, 0.040),
            (0.214, 0.034)]
    cz, rr = 0.268, 0.062
    a_start = math.degrees(math.asin((0.214 - cz) / rr))
    for k in range(1, 15):
        a = math.radians(a_start + (90 - a_start) * k / 14)
        prof.append((cz + rr * math.sin(a), rr * math.cos(a)))
    prof[-1] = (cz + rr, 0.0)
    prof = [(a * scale, r * scale) for a, r in prof]
    bm = bmesh.new()
    V.bm_lathe(bm, prof, "Z", loc, 128)
    ob = V.mesh_obj(name, bm, m)
    V.smooth(ob, 40)
    return ob


def rod(name, m, a, b, r=0.0085):
    a, b = Vector(a), Vector(b)
    d = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=32, radius1=r, radius2=r, depth=d.length)
    ob = V.mesh_obj(name, bm, m)
    ob.matrix_world = Matrix.Translation((a + b) / 2) @ d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.data.set_sharp_from_angle(angle=math.radians(40))
    return ob


def ball(name, m, c, r):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=r, matrix=Matrix.Translation(c))
    ob = V.mesh_obj(name, bm, m)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def rect_ring(bm, cx, cy, ow, od, iw, idp, z0, z1):
    """Rectangular frame (outer ow x od, inner iw x idp) as 4 boxes."""
    V.bm_box(bm, (cx - ow / 2, cy - od / 2, z0), (cx + ow / 2, cy - idp / 2, z1))
    V.bm_box(bm, (cx - ow / 2, cy + idp / 2, z0), (cx + ow / 2, cy + od / 2, z1))
    V.bm_box(bm, (cx - ow / 2, cy - idp / 2, z0), (cx - iw / 2, cy + idp / 2, z1))
    V.bm_box(bm, (cx + iw / 2, cy - idp / 2, z0), (cx + ow / 2, cy + idp / 2, z1))


# ----------------------------------------------------------------------------- steps
def step1(m):
    """The owner posts a bounty: coin stack + sealed card going into a steel escrow box."""
    slab("slab", 0.98, 0.70, 0.10, m.stone)
    shadow_catcher(-0.10)
    bx0, bx1, by = -0.10, 0.34, 0.15
    bm = bmesh.new()
    V.bm_box(bm, (bx0, -by, 0.0), (bx1, by, 0.26))
    body = V.mesh_obj("escrow_body", bm, m.satin_z)
    bm = bmesh.new()
    V.bm_box(bm, (bx0, -by, 0.266), (bx1, by, 0.322))
    lid = V.mesh_obj("escrow_lid", bm, m.satin_x)
    sx = (bx0 + bx1) / 2
    for ob in (body, lid):
        V.apply_booleans(ob, [V.cutter_box("slot", (sx - 0.13, -0.014, 0.12), (sx + 0.13, 0.014, 0.5))])
        V.smooth(ob)
        V.bevel(ob, 0.006, 3)
    bm = bmesh.new()
    rect_ring(bm, sx, 0.0, 0.31, 0.066, 0.26, 0.028, 0.322, 0.327)
    bez = V.mesh_obj("slot_bezel", bm, m.brass_x)
    V.smooth(bez)
    V.bevel(bez, 0.0015, 2)
    card = sealed_card("bounty_card", 0.22, 0.15, 0.006, m.card, m.wax, 0.028, seal_uv=(0.0, 0.036))
    card.matrix_world = Matrix.Translation((sx, 0.0, 0.322)) @ Matrix.Rotation(math.radians(90), 4, "X")
    me = coin_mesh()
    coin_stack(me, m.coin, (-0.28, -0.04, 0.0), 14, seed=1.3, name="stack")
    coin(me, m.coin, (-0.20, -0.235, 0.0), (0.0, 0.0, 0.4), "coin_loose")
    return dict(theta=60.0, yaw0=-12.0, lens=70.0)


def step2(m):
    """Agents bid, negotiate and hire: a lead token wired to two sub-tokens (two-level tree)."""
    slab("slab", 1.2, 0.9, 0.10, m.stone)
    shadow_catcher(-0.10)
    bm = bmesh.new()
    V.bm_box(bm, (-0.19, 0.0, 0.0), (0.19, 0.36, 0.15))
    step = V.mesh_obj("riser", bm, m.stone)
    V.smooth(step)
    V.bevel(step, 0.006, 3)
    lead_s, sub_s = 1.25, 0.85
    lead_c = Vector((0.0, 0.18, 0.15))
    subs = [Vector((-0.33, -0.2, 0.0)), Vector((0.33, -0.2, 0.0))]
    pawn("lead", m.polished, lead_s, lead_c)
    # canary collar marks the lead
    bm = bmesh.new()
    prof = [(0.177, 0.0505), (0.177, 0.0545), (0.199, 0.0545), (0.199, 0.0505)]
    V.bm_lathe(bm, [(a * lead_s, r * lead_s) for a, r in prof], "Z", lead_c, 128)
    band = V.mesh_obj("lead_band", bm, m.enamel)
    V.smooth(band, 40)
    collar = 0.188
    a_top = lead_c + Vector((0, 0, collar * lead_s))
    for i, s in enumerate(subs):
        pawn(f"sub_{i}", m.polished, sub_s, s)
        b_top = s + Vector((0, 0, collar * sub_s))
        dxy = Vector((b_top.x - a_top.x, b_top.y - a_top.y, 0)).normalized()
        a = a_top + dxy * 0.055 * lead_s
        b = b_top - dxy * 0.055 * sub_s
        rod(f"rod_{i}", m.brass_x, a, b)
        ball(f"joint_a{i}", m.brass_x, a, 0.012)
        ball(f"joint_b{i}", m.brass_x, b, 0.011)
    return dict(theta=60.0, yaw0=-17.5, lens=70.0)


def vault_scene(m, plinth=1.34, plinth_h=0.45, lift=0.0):
    V.PL, V.PL_H = plinth, plinth_h
    before = set(bpy.data.objects)
    V.build_vault(m.steel_x, m.steel_y, m.steel_z, m.glass, m.gunmetal)
    V.build_key_and_lock(m.brass_x, m.brass_rz, m.enamel, m.steel_rx, m.steel_x)
    bpy.data.objects["lock_plug"].data.materials[0] = m.brass_rx
    if lift:
        for ob in set(bpy.data.objects) - before:
            if ob.parent is None:
                ob.matrix_world = Matrix.Translation((0, 0, lift)) @ ob.matrix_world
    V.build_plinth(m.stone, shadow=True)


def step3(m):
    """Every attack is one sealed message: a wax-sealed card half inside the vault's lid slot."""
    vault_scene(m)
    glass = bpy.data.objects["glass"]
    lid_z = V.S - V.B / 2
    V.apply_booleans(glass, [V.cutter_box("lid_slot", (-0.23, -0.016, lid_z - 0.03), (0.23, 0.016, lid_z + 0.03))])
    bm = bmesh.new()
    top = lid_z + V.GLASS_T / 2
    rect_ring(bm, 0.0, 0.0, 0.52, 0.085, 0.46, 0.032, top - 0.002, top + 0.010)
    bez = V.mesh_obj("lid_slot_bezel", bm, m.steel_x)
    V.smooth(bez)
    V.bevel(bez, 0.002, 2)
    card = sealed_card("message_card", 0.40, 0.36, 0.008, m.card, m.wax, 0.05, seal_uv=(0.0, 0.085))
    card.matrix_world = Matrix.Translation((0.0, 0.0, top)) @ Matrix.Rotation(math.radians(90), 4, "X")
    return dict(theta=57.0, yaw0=10.0, lens=70.0)


def step4(m):
    """A TEE runs it: the vault (key inside) standing on a thin brushed-steel chip."""
    ct = 0.05
    vault_scene(m, plinth=1.66, plinth_h=0.42, lift=ct)
    hw, ch = 0.65, 0.08
    out = [(hw - ch, -hw), (hw, -hw + ch), (hw, hw - ch), (hw - ch, hw), (-hw + ch, hw), (-hw, hw - ch),
           (-hw, -hw + ch), (-hw + ch, -hw)]
    bm = bmesh.new()
    V.bm_prism(bm, out, 0.012, ct)
    chip = V.mesh_obj("chip", bm, m.satin_x)
    V.smooth(chip)
    V.bevel(chip, 0.003, 2)
    bm = bmesh.new()
    V.bm_box(bm, (-hw + 0.03, -hw + 0.03, 0.0), (hw - 0.03, hw - 0.03, 0.013))
    base = V.mesh_obj("chip_substrate", bm, m.gunmetal)
    V.smooth(base)
    V.bevel(base, 0.002, 2)
    # gull-wing leads on all four sides
    bm = bmesh.new()
    n, lw, pitch = 15, 0.018, 0.068
    for side in range(4):
        rot = Matrix.Rotation(math.radians(90 * side), 3, "Z")
        for i in range(n):
            t = (i - (n - 1) / 2) * pitch
            for lo, hi in (((hw - 0.005, t - lw / 2, 0.020), (hw + 0.030, t + lw / 2, 0.027)),
                           ((hw + 0.024, t - lw / 2, 0.0), (hw + 0.031, t + lw / 2, 0.027)),
                           ((hw + 0.024, t - lw / 2, 0.0), (hw + 0.056, t + lw / 2, 0.006))):
                corners = [Vector(lo), Vector(hi)]
                a = rot @ corners[0]
                b = rot @ corners[1]
                V.bm_box(bm, (min(a.x, b.x), min(a.y, b.y), lo[2]), (max(a.x, b.x), max(a.y, b.y), hi[2]))
    leads = V.mesh_obj("chip_leads", bm, m.brass_x)
    V.smooth(leads)
    V.bevel(leads, 0.0012, 1)
    return dict(theta=57.0, yaw0=10.0, lens=70.0)


def step5(m):
    """Paid in the same step, or not at all: the stack splits in two beside the sealed report."""
    slab("slab", 0.98, 0.70, 0.10, m.stone)
    shadow_catcher(-0.10)
    me = coin_mesh()
    T = 0.013
    A, Bc = Vector((-0.24, 0.06, 0.0)), Vector((0.05, 0.12, 0.0))
    coin_stack(me, m.coin, A, 12, seed=2.1, name="stack_attacker")
    coin_stack(me, m.coin, Bc, 6, seed=4.7, name="stack_lead")
    # two coins caught mid-flight from the attacker stack to the lead stack
    p0 = A + Vector((0, 0, 12 * T + 0.02))
    p1 = Bc + Vector((0, 0, 6 * T + 0.02))
    d = (p1 - p0)
    yaw = math.atan2(d.y, d.x)
    for k, u in enumerate((0.38, 0.72)):
        pos = p0.lerp(p1, u) + Vector((0, 0, 0.13 * math.sin(math.pi * u)))
        tilt = math.radians(-28 + 30 * u)
        coin(me, m.coin, pos, (0.0, tilt, yaw), f"coin_flight_{k}")
    card = sealed_card("report_card", 0.25, 0.18, 0.006, m.card, m.wax, 0.032, seal_uv=(0.045, 0.0))
    card.matrix_world = Matrix.Translation((0.25, -0.15, 0.003)) @ Matrix.Rotation(math.radians(-14), 4, "Z")
    return dict(theta=60.0, yaw0=-12.0, lens=70.0)


def relight():
    """Same rig as vault.py, adjusted for small tabletop subjects seen from ~30deg: the key light
    sits higher (short shadows that stay off the frame border) and the rim light rises out of
    the mirror angle of flat up-facing metal (escrow lid, chip) and is dimmed."""
    tgt = Vector((0.0, 0.0, 0.3))
    for name, pos, energy in (("key", (-3.2, -1.9, 4.6), None), ("rim", (1.7, 3.4, 5.6), RIM_ENERGY)):
        ob = bpy.data.objects[name]
        ob.location = pos
        ob.rotation_euler = (tgt - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
        if energy is not None:
            ob.data.energy = energy


STEPS = {1: step1, 2: step2, 3: step3, 4: step4, 5: step5}


# ----------------------------------------------------------------------------- camera
def subject_objects():
    return [o for o in bpy.data.objects if o.type == "MESH" and not o.is_shadow_catcher
            and not o.hide_render]


def project_bounds(objs, cam_ob, sc, dg):
    xs, ys = [], []
    for ob in objs:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ev.matrix_world
        for v in me.vertices:
            p = world_to_camera_view(sc, cam_ob, mw @ v.co)
            xs.append(p.x)
            ys.append(1.0 - p.y)
        ev.to_mesh_clear()
    return min(xs), min(ys), max(xs), max(ys)


def pose(cam_ob, T, dist, theta, psi):
    fwd = Matrix.Rotation(psi, 3, "Z") @ Vector((0.0, math.sin(theta), -math.cos(theta)))
    cam_ob.location = T - fwd * dist
    cam_ob.rotation_euler = (theta, 0.0, psi)


def yaw_at(f, yaw0):
    return math.radians(yaw0 + ORBIT * V.smoothstep(f / (N_FRAMES - 1)))


def build_camera(spec):
    sc = bpy.context.scene
    cd = bpy.data.cameras.new("cam")
    cd.sensor_fit = "HORIZONTAL"
    cd.sensor_width = SENSOR_W
    cd.lens = spec["lens"]
    cd.clip_start = 0.01
    cd.clip_end = 100.0
    cam = V.link(bpy.data.objects.new("cam", cd))
    cam.rotation_mode = "XYZ"
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = W, H
    objs = subject_objects()
    dg = bpy.context.evaluated_depsgraph_get()
    lo = Vector((1e9, 1e9, 1e9))
    hi = -lo
    for ob in objs:
        ev = ob.evaluated_get(dg)
        for c in ev.bound_box:
            p = ev.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    T = (lo + hi) / 2
    theta = math.radians(spec["theta"])
    dist = 4.0
    samples = [0, 12, 24, 36, N_FRAMES - 1]
    frame_h = SENSOR_W * H / W / spec["lens"]          # frame height per unit distance
    for _ in range(6):                                 # fit height to FILL, centre the union bounds
        b = [1e9, 1e9, -1e9, -1e9]
        for f in samples:
            pose(cam, T, dist, theta, yaw_at(f, spec["yaw0"]))
            bpy.context.view_layer.update()
            dg = bpy.context.evaluated_depsgraph_get()
            x0, y0, x1, y1 = project_bounds(objs, cam, sc, dg)
            b = [min(b[0], x0), min(b[1], y0), max(b[2], x1), max(b[3], y1)]
        hfrac, wfrac = b[3] - b[1], b[2] - b[0]
        cy = (b[1] + b[3]) / 2 - 0.5
        cx = (b[0] + b[2]) / 2 - 0.5
        psi_mid = yaw_at(N_FRAMES // 2, spec["yaw0"])
        up = Matrix.Rotation(psi_mid, 3, "Z") @ Vector((0.0, math.cos(theta), math.sin(theta)))
        right = Matrix.Rotation(psi_mid, 3, "Z") @ Vector((1.0, 0.0, 0.0))
        T = T - up * (cy * frame_h * dist) + right * (cx * frame_h * dist * W / H)
        dist *= max(hfrac / FILL, wfrac / 0.78)   # rt-site: keep x within 0.1-0.9
    spec["bounds"] = b
    spec["dist"] = dist
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    for f in range(N_FRAMES):
        pose(cam, T, dist, theta, yaw_at(f, spec["yaw0"]))
        cam.keyframe_insert("location", frame=f)
        cam.keyframe_insert("rotation_euler", frame=f)
    return cam


# ----------------------------------------------------------------------------- main
def main():
    args = parse_args()
    steps = [int(s) for s in args.steps.split(",") if s.strip()]
    if "-" in args.frames:
        a, b = (int(x) for x in args.frames.split("-"))
        frames = list(range(a, b + 1))
    else:
        frames = [int(x) for x in args.frames.split(",")]
    for step in steps:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        m = materials()
        V.WORLD_BLOB = WORLD_BLOB
        V.build_world()
        V.build_lights()
        relight()
        spec = STEPS[step](m)
        V.setup_render(SimpleNamespace(cpu=args.cpu, samples=args.samples, noise=args.noise,
                                       pct=args.pct, exposure=None))
        sc = bpy.context.scene
        build_camera(spec)
        sc.render.resolution_x, sc.render.resolution_y = W, H
        sc.frame_start, sc.frame_end = 0, N_FRAMES - 1
        print(f"[how] step{step} '{STEP_NAMES[step]}': dist {spec['dist']:.2f}, union bounds "
              + " ".join(f"{v:.3f}" for v in spec["bounds"]), flush=True)
        if args.report:
            dg = bpy.context.evaluated_depsgraph_get()
            for f in (0, N_FRAMES // 2, N_FRAMES - 1):
                sc.frame_set(f)
                dg = bpy.context.evaluated_depsgraph_get()
                bnd = project_bounds(subject_objects(), sc.camera.evaluated_get(dg), sc, dg)
                print(f"[how] step{step} f{f:03d} bounds " + " ".join(f"{v:.3f}" for v in bnd), flush=True)
        if args.save:
            os.makedirs(args.save, exist_ok=True)
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.abspath(args.save), f"step{step}.blend"),
                                        compress=True)
        out = os.path.join(args.out, f"step{step}")
        os.makedirs(out, exist_ok=True)
        log = open(os.path.join(out, "timing.tsv"), "a")
        t_all, done = time.time(), 0
        for f in frames:
            path = os.path.join(out, f"f{f:03d}.png")
            if os.path.exists(path) and not args.overwrite:
                continue
            sc.frame_set(f)
            sc.render.filepath = path
            t0 = time.time()
            bpy.ops.render.render(write_still=True)
            dt = time.time() - t0
            done += 1
            log.write(f"{f}\t{dt:.1f}\t{args.pct}\t{args.samples}\n")
            log.flush()
            print(f"[how] step{step} f{f:03d} rendered in {dt:.1f}s ({done}/{len(frames)})", flush=True)
        log.close()
        print(f"[how] step{step} done: {done} frames in {time.time() - t_all:.0f}s", flush=True)


if __name__ == "__main__":
    main()
