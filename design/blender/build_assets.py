"""
FEEDBACK 3D family — built procedurally so it can be regenerated headless:

  blender -b -P design/blender/build_assets.py -- [--quick] [--only disc,case,cable,stilllife]

Creates:  design/blender/feedback_assets.blend
Renders:  brand/marketing/renders/*.png
Exports:  design/blender/exports/feedback-disc.glb, feedback-jewelcase.glb
"""
import bpy, bmesh, math, os, sys, random
from mathutils import Vector, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
TEX = os.path.join(HERE, "textures")
RENDERS = os.path.join(ROOT, "brand", "marketing", "renders")
EXPORTS = os.path.join(HERE, "exports")
os.makedirs(RENDERS, exist_ok=True)
os.makedirs(EXPORTS, exist_ok=True)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
QUICK = "--quick" in argv
ONLY = None
if "--only" in argv:
    ONLY = set(argv[argv.index("--only") + 1].split(","))
random.seed(7)

def log(*a):
    print("[FEEDBACK-3D]", *a, flush=True)

# ---------------------------------------------------------------- helpers
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def link(obj, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj

def set_input(node, names, value):
    for n in ([names] if isinstance(names, str) else names):
        if n in node.inputs:
            try:
                node.inputs[n].default_value = value
                return True
            except Exception as e:
                log("input fail", n, e)
    return False

def principled(name, **kw):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    p = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    mapping = {
        "base": "Base Color", "metal": "Metallic", "rough": "Roughness", "ior": "IOR",
        "trans": ["Transmission Weight", "Transmission"], "coat": ["Coat Weight", "Coat"], "coat_rough": "Coat Roughness",
        "spec": ["Specular IOR Level", "Specular"], "aniso": "Anisotropic", "film": "Thin Film Thickness", "film_ior": "Thin Film IOR",
        "emit": ["Emission Color", "Emission"], "emit_strength": "Emission Strength", "alpha": "Alpha",
    }
    for k, v in kw.items():
        if k in mapping:
            set_input(p, mapping[k], v)
    return m, nt, p

def img_node(nt, path, non_color=False):
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = bpy.data.images.load(path, check_existing=True)
    if non_color:
        try:
            n.image.colorspace_settings.name = "Non-Color"
        except Exception:
            pass
    return n

def scratch_roughness(nt, p, base_rough, amount, scale=1.0):
    """Mix scratch mask into roughness (and a whisper of bump) so reflections break up like handled plastic."""
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (scale, scale, scale)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    im = img_node(nt, os.path.join(TEX, "scratch-mask.png"), non_color=True)
    im.extension = "REPEAT"
    nt.links.new(mp.outputs["Vector"], im.inputs["Vector"])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["To Min"].default_value = base_rough
    mr.inputs["To Max"].default_value = min(1.0, base_rough + amount)
    nt.links.new(im.outputs["Color"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], p.inputs["Roughness"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.06
    bump.inputs["Distance"].default_value = 0.0002
    nt.links.new(im.outputs["Color"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], p.inputs["Normal"])

def planar_uv(obj, size):
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = (co.x / size + 0.5, co.y / size + 0.5)

def bevel(obj, width, segments=3):
    m = obj.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    return m

def smooth(obj):
    for p in obj.data.polygons:
        p.use_smooth = True

# ---------------------------------------------------------------- disc
def ring_mesh(name, r_in, r_out, z0, z1, verts=160):
    bm = bmesh.new()
    rings = []
    for z in (z0, z1):
        for r in (r_in, r_out):
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / verts), r * math.sin(2 * math.pi * i / verts), z)) for i in range(verts)])
    bi, bo, ti, to = rings
    for i in range(verts):
        j = (i + 1) % verts
        bm.faces.new((bo[i], bo[j], bi[j], bi[i]))  # bottom
        bm.faces.new((ti[i], ti[j], to[j], to[i]))  # top
        bm.faces.new((bo[i], to[i], to[j], bo[j]))  # outer wall
        bm.faces.new((bi[j], ti[j], ti[i], bi[i]))  # inner wall
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    return obj

def make_disc(coll=None, name="FeedbackDisc"):
    """120 mm CD: clear hub, mirrored data band with thin-film rainbow, printed label on top."""
    s = 1.0  # metres; disc diameter 0.12
    parent = bpy.data.objects.new(name, None)
    link(parent, coll)
    # polycarbonate body (clear)
    body = link(ring_mesh(name + "_Body", 0.0075, 0.06, 0.0, 0.0012), coll)
    body.parent = parent
    m, nt, p = principled("Polycarbonate", base=(0.9, 0.9, 0.9, 1), trans=1.0, ior=1.58, rough=0.03, coat=0.3)
    scratch_roughness(nt, p, 0.02, 0.35, scale=6.0)
    body.data.materials.append(m)
    # data layer: thin mirrored annulus between 23 mm and 58 mm, sits inside
    data = link(ring_mesh(name + "_Data", 0.0175, 0.0585, 0.00035, 0.0005), coll)
    data.parent = parent
    m2, nt2, p2 = principled("DataLayer", base=(0.85, 0.86, 0.9, 1), metal=1.0, rough=0.08, film=520.0, film_ior=1.45, aniso=0.6)
    data.data.materials.append(m2)
    # printed label on top (UV planar)
    label = link(ring_mesh(name + "_Label", 0.0185, 0.0585, 0.00121, 0.00126), coll)
    label.parent = parent
    planar_uv(label, 0.12)
    m3, nt3, p3 = principled("LabelPrint", rough=0.55, spec=0.3)
    im = img_node(nt3, os.path.join(TEX, "disc-label.png"))
    nt3.links.new(im.outputs["Color"], p3.inputs["Base Color"])
    label.data.materials.append(m3)
    # stacking ring bump
    stack = link(ring_mesh(name + "_Stack", 0.0105, 0.0112, 0.0012, 0.00135), coll)
    stack.parent = parent
    stack.data.materials.append(m)
    for o in (body, data, label, stack):
        smooth(o)
    return parent, [body, data, label, stack]

# ---------------------------------------------------------------- jewel case
def box(name, dims, loc=(0, 0, 0), coll=None):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object
    o.name = name
    o.scale = (dims[0], dims[1], dims[2])
    o.location = loc
    bpy.ops.object.transform_apply(scale=True)
    if coll:
        for c in o.users_collection:
            c.objects.unlink(o)
        coll.objects.link(o)
    return o

def make_case(coll=None, name="JewelCase"):
    """Standard 142 × 125 × 10 mm jewel case with insert, black tray and hinge knuckles."""
    W, H, D = 0.142, 0.125, 0.0104
    parent = bpy.data.objects.new(name, None)
    link(parent, coll)
    plastic, ntp, pp = principled("JewelPlastic", base=(0.95, 0.96, 0.97, 1), trans=1.0, ior=1.49, rough=0.02)
    scratch_roughness(ntp, pp, 0.015, 0.45, scale=4.0)
    tray_m, _, _ = principled("TrayBlack", base=(0.012, 0.012, 0.012, 1), rough=0.35, spec=0.4)
    lid = box(name + "_Lid", (W, H, 0.0016), (0, 0, D - 0.0008), coll)
    bevel(lid, 0.0006)
    lid.data.materials.append(plastic)
    base = box(name + "_Base", (W, H, 0.0016), (0, 0, 0.0008), coll)
    bevel(base, 0.0006)
    base.data.materials.append(plastic)
    for side in (-1, 1):
        wall = box(f"{name}_Wall{side}", (W, 0.0014, D - 0.003), (0, side * (H / 2 - 0.0007), D / 2), coll)
        bevel(wall, 0.0004)
        wall.data.materials.append(plastic)
    tray = box(name + "_Tray", (W - 0.012, H - 0.004, 0.0045), (0.005, 0, 0.0038), coll)
    bevel(tray, 0.0008)
    tray.data.materials.append(tray_m)
    # rosette hub
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.0075, depth=0.003, location=(0.005, 0, 0.0068))
    hub = bpy.context.active_object
    hub.name = name + "_Hub"
    hub.data.materials.append(tray_m)
    # insert under the lid
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0.004, 0, D - 0.0018))
    ins = bpy.context.active_object
    ins.name = name + "_Insert"
    ins.scale = (0.12, 0.12, 1)
    bpy.ops.object.transform_apply(scale=True)
    m_ins, ntn, pn = principled("InsertPrint", rough=0.45)
    im = img_node(ntn, os.path.join(TEX, "insert-front.png"))
    ntn.links.new(im.outputs["Color"], pn.inputs["Base Color"])
    ins.data.materials.append(m_ins)
    # hinge knuckles
    for i, y in enumerate((-0.05, -0.02, 0.02, 0.05)):
        bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.0022, depth=0.018, location=(-W / 2 + 0.0015, y, D / 2), rotation=(math.pi / 2, 0, 0))
        k = bpy.context.active_object
        k.name = f"{name}_Hinge{i}"
        k.data.materials.append(plastic)
    for o in bpy.context.scene.objects:
        if o.name.startswith(name + "_") and o.parent is None:
            o.parent = parent
            if coll and o.name not in coll.objects:
                for c in list(o.users_collection):
                    c.objects.unlink(o)
                coll.objects.link(o)
    return parent

# ---------------------------------------------------------------- cable + jack
def make_jack(name, coll=None):
    """1/4 in TS jack plug made by lathing a profile (screw modifier)."""
    # (radius, z) profile from tip to boot
    prof = [(0.0, 0.0), (0.0024, 0.0012), (0.0026, 0.0038), (0.0019, 0.0046), (0.0019, 0.0062), (0.0031, 0.0066), (0.0031, 0.0165),
            (0.0034, 0.0175), (0.0048, 0.0185), (0.0048, 0.052), (0.0042, 0.058), (0.0034, 0.075), (0.0030, 0.083)]
    me = bpy.data.meshes.new(name + "_Profile")
    bm = bmesh.new()
    vs = [bm.verts.new((r, 0, z)) for r, z in prof]
    for a, b in zip(vs, vs[1:]):
        bm.edges.new((a, b))
    bm.to_mesh(me)
    bm.free()
    obj = link(bpy.data.objects.new(name, me), coll)
    sc = obj.modifiers.new("Lathe", "SCREW")
    sc.axis = "Z"
    sc.steps = 48
    sc.render_steps = 64
    sc.use_merge_vertices = True
    sc.use_smooth_shade = True
    chrome, _, _ = principled("ScratchedChrome", base=(0.9, 0.9, 0.92, 1), metal=1.0, rough=0.18, aniso=0.5)
    shell, _, _ = principled("BlackShell", base=(0.02, 0.02, 0.022, 1), metal=0.6, rough=0.42)
    ring, _, _ = principled("InsulatorRing", base=(0.01, 0.01, 0.01, 1), rough=0.3)
    me.materials.append(chrome)
    me.materials.append(shell)
    me.materials.append(ring)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier="Lathe")
    for poly in obj.data.polygons:
        zc = sum(obj.data.vertices[v].co.z for v in poly.vertices) / len(poly.vertices)
        poly.material_index = 0 if zc < 0.0165 else 1
        if 0.0045 < zc < 0.0064:
            poly.material_index = 2
        poly.use_smooth = True
    return obj

def make_cable(name="CableLoop", coll=None, points=None, radius=0.0032):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 6
    cu.resolution_u = 24
    sp = cu.splines.new("BEZIER")
    sp.bezier_points.add(len(points) - 1)
    for bp, co in zip(sp.bezier_points, points):
        bp.co = co
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    obj = link(bpy.data.objects.new(name, cu), coll)
    m, nt, p = principled("CableRubber", base=(0.012, 0.012, 0.013, 1), rough=0.6, coat=0.15, coat_rough=0.4)
    # fine braid-ish noise bump
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 900.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.25
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], p.inputs["Normal"])
    cu.materials.append(m)
    return obj

def attach_jack(jack, pts):
    """Plug the jack onto the cable end: boot meets the last point, tip points along the cable tangent."""
    end = Vector(pts[-1])
    tangent = (Vector(pts[-1]) - Vector(pts[-2])).normalized()
    jack.rotation_mode = "QUATERNION"
    jack.rotation_quaternion = (-tangent).to_track_quat("Z", "Y")
    jack.location = end + tangent * 0.083

def coil_points(cx, cy, z, r, loops=2.3, n=40, drift=0.012, jitter=0.004, tail=(0.09, -0.05)):
    pts = []
    for i in range(n):
        t = i / (n - 1)
        a = t * loops * 2 * math.pi
        rr = r + math.sin(a * 0.5) * jitter + random.uniform(-jitter, jitter) * 0.4
        pts.append((cx + rr * math.cos(a) + t * drift, cy + rr * math.sin(a) * 0.92, z + 0.0034 + 0.0025 * max(0.0, math.sin(a * 2.1)) * (1 - t)))
    last = Vector(pts[-1])
    for k in (1, 2):
        pts.append((last.x + tail[0] * k / 2, last.y + tail[1] * k / 2, z + 0.0034))
    return pts

# ---------------------------------------------------------------- stage: floor, lights, camera
def world_dark():
    w = bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    bg = next((n for n in w.node_tree.nodes if n.type == "BACKGROUND"), None)
    if bg:
        bg.inputs["Color"].default_value = (0.002, 0.002, 0.0022, 1)
        bg.inputs["Strength"].default_value = 1.0

def floor():
    bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, 0))
    f = bpy.context.active_object
    f.name = "Floor"
    m, nt, p = principled("WornStage", base=(0.006, 0.006, 0.0065, 1), rough=0.16, spec=0.5)
    scratch_roughness(nt, p, 0.1, 0.22, scale=9.0)
    f.data.materials.append(m)
    return f

def area(name, loc, rot, size, energy, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = energy
    ld.size = size
    ld.color = color
    o = link(bpy.data.objects.new(name, ld))
    o.location = loc
    o.rotation_euler = rot
    return o

def aim(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()

def camera(loc, target, lens=85, fstop=2.8, focus=None):
    cd = bpy.data.cameras.new("Camera")
    cd.lens = lens
    cd.dof.use_dof = True
    cd.dof.aperture_fstop = fstop
    cd.dof.focus_distance = focus or (Vector(target) - Vector(loc)).length
    c = link(bpy.data.objects.new("Camera", cd))
    c.location = loc
    aim(c, target)
    bpy.context.scene.camera = c
    return c

def render_settings(res=(1920, 1080), samples=160):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for dev_type in ("OPTIX", "CUDA"):
            try:
                prefs.compute_device_type = dev_type
                prefs.get_devices()
                if any(d.type == dev_type for d in prefs.devices):
                    for d in prefs.devices:
                        d.use = d.type == dev_type
                    sc.cycles.device = "GPU"
                    log("render device", dev_type)
                    break
            except Exception:
                continue
    except Exception as e:
        log("gpu setup failed, CPU", e)
    sc.cycles.samples = 24 if QUICK else samples
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 10
    sc.cycles.transmission_bounces = 10
    sc.cycles.glossy_bounces = 6
    sc.render.resolution_x, sc.render.resolution_y = (res[0] // 2, res[1] // 2) if QUICK else res
    sc.render.image_settings.file_format = "PNG"
    try:
        sc.view_settings.view_transform = "AgX"
        sc.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        try:
            sc.view_settings.look = "Punchy"
        except Exception:
            pass

def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    log("rendered", path)

def export_glb(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
        for ch in o.children_recursive:
            ch.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_image_format="JPEG", export_yup=True)
    log("exported", path, os.path.getsize(path))

# ---------------------------------------------------------------- scenes
def scene_disc():
    reset()
    world_dark()
    floor()
    disc, parts = make_disc()
    disc.location = (0, 0, 0.06 * math.sin(math.radians(62)) + 0.001)
    disc.rotation_euler = (math.radians(62), 0, math.radians(18))
    # a second disc lying flat, out of focus
    d2, _ = make_disc(name="DiscBack")
    d2.location = (-0.09, 0.11, 0.0002)
    d2.rotation_euler = (0, 0, math.radians(40))
    key = area("Key", (0.25, -0.35, 0.45), (0, 0, 0), 0.35, 14)
    aim(key, (0, 0, 0.03))
    rim = area("RimRed", (-0.4, 0.25, 0.12), (0, 0, 0), 0.25, 45, (1.0, 0.12, 0.15))
    aim(rim, (0, 0, 0.03))
    strip = area("Strip", (0.05, 0.4, 0.3), (0, 0, 0), 0.6, 10)
    strip.data.shape = "RECTANGLE"
    strip.data.size_y = 0.03
    aim(strip, (0, 0, 0.03))
    camera((0.02, -0.36, 0.13), (0, 0, 0.05), lens=65, fstop=2.2)
    render_settings()
    render(os.path.join(RENDERS, "disc-hero.png"))
    export_glb([disc], os.path.join(EXPORTS, "feedback-disc.glb"))

def scene_case():
    reset()
    world_dark()
    floor()
    case = make_case()
    case.location = (0, 0, 0)
    case.rotation_euler = (math.radians(86), 0, math.radians(-14))
    case.location = (0, 0.02, 0.125 / 2 * math.sin(math.radians(86)) + 0.001)
    pts = coil_points(0.06, -0.12, 0.0, 0.045, tail=(0.08, -0.06))
    cable = make_cable(points=pts)
    jack = make_jack("Jack")
    attach_jack(jack, pts)
    key = area("Key", (0.3, -0.4, 0.5), (0, 0, 0), 0.5, 12)
    aim(key, (0, 0, 0.05))
    rim = area("RimRed", (-0.45, 0.3, 0.2), (0, 0, 0), 0.3, 50, (1.0, 0.1, 0.13))
    aim(rim, (0, 0.02, 0.06))
    top = area("Top", (0, 0.1, 0.6), (0, 0, 0), 0.4, 6)
    aim(top, (0, 0, 0))
    camera((0.05, -0.42, 0.075), (0.0, 0.0, 0.06), lens=55, fstop=4.0)
    render_settings()
    render(os.path.join(RENDERS, "jewelcase-cable.png"))
    export_glb([case], os.path.join(EXPORTS, "feedback-jewelcase.glb"))

def scene_stilllife():
    reset()
    world_dark()
    floor()
    case = make_case()
    case.rotation_euler = (math.radians(82), 0, math.radians(8))
    case.location = (0.02, 0.06, 0.125 / 2 * math.sin(math.radians(82)) + 0.001)
    disc, _ = make_disc()
    disc.rotation_euler = (math.radians(74), 0, math.radians(-24))
    disc.location = (-0.085, 0.0, 0.06 * math.sin(math.radians(74)) + 0.0008)
    flat, _ = make_disc(name="DiscFlat")  # a second disc face-down on the stage
    flat.location = (0.14, -0.02, 0.0001)
    flat.rotation_euler = (math.radians(180), 0, math.radians(30))
    flat.location.z = 0.0013
    pts = coil_points(-0.03, -0.12, 0.0, 0.05, loops=2.2, n=44, drift=0.02, tail=(0.11, -0.03))
    make_cable(points=pts)
    jack = make_jack("Jack")
    attach_jack(jack, pts)
    key = area("Key", (-0.15, -0.5, 0.45), (0, 0, 0), 0.5, 13)
    aim(key, (0, 0, 0.05))
    rim = area("RimRed", (-0.55, 0.35, 0.18), (0, 0, 0), 0.35, 60, (1.0, 0.1, 0.13))
    aim(rim, (0, 0.03, 0.05))
    back = area("Back", (0.2, 0.6, 0.25), (0, 0, 0), 0.3, 8)
    aim(back, (0, 0, 0.05))
    camera((0.0, -0.52, 0.2), (0.0, 0.0, 0.045), lens=50, fstop=2.8)
    render_settings((2560, 1440))
    render(os.path.join(RENDERS, "stilllife-hero.png"))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "feedback_assets.blend"))
    log("saved blend")

for key, fn in [("disc", scene_disc), ("case", scene_case), ("stilllife", scene_stilllife)]:
    if ONLY and key not in ONLY:
        continue
    try:
        fn()
    except Exception as e:
        import traceback
        traceback.print_exc()
        log("FAILED", key, e)
log("done")
