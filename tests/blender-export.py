import importlib.util
import json
import math
import os
import sys

import bpy
sys.dont_write_bytecode = True
from mathutils import Vector


root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("fpp2_addon", os.path.join(root, "tools", "blender", "fpp2.py"))
addon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(addon)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def cube(name, location, scale, role=None, visual=False):
    bpy.ops.mesh.primitive_cube_add(size=2, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    if role is not None:
        obj["fpp2_role"] = role
    if visual:
        obj["fpp2_visual_only"] = True
    return obj


def visual_child(parent, name, location, scale, material):
    child = cube(name, location, scale, visual=True)
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()
    child.data.materials.append(material)
    return child


def slope_proxy(name, location, dimensions, rise):
    width, height, depth = dimensions
    vertices = []
    for x in (-width / 2, width / 2):
        for y in (-height / 2, height / 2):
            for z in (-depth / 2, depth / 2):
                game_y = x * rise / width + y
                vertices.append((x, -z, game_y))
    faces = ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    obj["fpp2_role"] = "platform"
    obj["fpp2_collision"] = "slope"
    obj["fpp2_dimensions"] = dimensions
    obj["fpp2_rise"] = rise
    return obj


clear_scene()
scene = bpy.context.scene
scene["fpp2_level"] = "blender-check"
scene["fpp2_failure_y"] = -12
scene["fpp2_test_from"] = "moving-platform"

spawn = bpy.data.objects.new("Player spawn", None)
scene.collection.objects.link(spawn)
spawn.location = (0, 0, 2)
spawn["fpp2_role"] = "spawn"

material = bpy.data.materials.new("Test material")
material.diffuse_color = (0.3, 0.6, 0.2, 1)
second_material = bpy.data.materials.new("Second face material")
second_material.diffuse_color = (0.8, 0.2, 0.1, 1)

ground = cube("ground", (0, 0, 0), (5, 5, 0.5), role="ground")
ground_visual = visual_child(ground, "ground visual", (0, 0, 0.5), (5, 0.25, 5), material)
ground_visual.data.materials.append(second_material)
for index, polygon in enumerate(ground_visual.data.polygons):
    polygon.material_index = index % 2
uv_layer = ground_visual.data.uv_layers.active
assert uv_layer is not None
for loop in uv_layer.data:
    loop.uv = (loop.uv.x * 2.0 + 0.125, loop.uv.y * 3.0 + 0.25)

ground_parent = bpy.data.objects.new("Level group", None)
scene.collection.objects.link(ground_parent)
ground.parent = ground_parent
ground.location = (1, 0, 0)
ground.rotation_euler.z = 0.1

moving = cube("moving platform", (4, 0, 2), (1, 0.5, 1), role="platform")
moving.rotation_euler.z = math.pi / 4
moving.scale = (2, 1, 0.5)
moving["fpp2_visual_only"] = True
moving["fpp2_motion_duration"] = 4
moving["fpp2_motion_phase"] = 0.25
moving["fpp2_motion_mode"] = "ping-pong"
moving["fpp2_mode"] = "one-way"
moving["fpp2_crumble_delay"] = 1.5
moving["fpp2_crumble_return_delay"] = 3
moving["fpp2_surface_profile"] = "ice"
moving["fpp2_surface_traction"] = 0.2
visual_child(moving, "moving visual", (4, 0, 3.2), (1, 0.4, 0.5), material)

for index, location in enumerate(((4, 0, 2), (6, 0, 2))):
    waypoint = bpy.data.objects.new(f"Waypoint {index:02}", None)
    scene.collection.objects.link(waypoint)
    waypoint.parent = moving
    waypoint.matrix_parent_inverse = moving.matrix_world.inverted()
    waypoint.location = location
    waypoint["fpp2_waypoint"] = True
    waypoint["fpp2_order"] = index

slope = slope_proxy("shallow slope", (7, 0, 0.5), [2, 1, 2], 0.4)
slope["fpp2_visual_only"] = True
slope.data.materials.append(material)
visual_child(slope, "slope visual", (7, 0, 1.2), (1, 0.3, 1), material)

checkpoint = cube("checkpoint", (-2, 0, 1), (0.5, 0.5, 1), role="checkpoint", visual=True)
goal = cube("goal", (10, 0, 1), (0.5, 0.5, 1), role="goal", visual=True)

scenery = cube("large tree", (-5, 0, 2), (1, 0.5, 2), visual=True)
scenery["fpp2_scenery"] = True

invalid = cube("unsupported", (0, 4, 0), (1, 1, 1), role="platform")
invalid["fpp2_collision"] = "mesh"
try:
    addon.level_publication(scene)
    raise AssertionError("unsupported collider should fail publication")
except ValueError as error:
    assert "solid collision must be box or slope" in str(error)
bpy.data.objects.remove(invalid, do_unlink=True)

off_center = cube("off center", (0, 5, 0), (1, 1, 1), role="platform")
off_center.data.transform(__import__("mathutils").Matrix.Translation((0.5, 0, 0)))
try:
    addon.level_publication(scene)
    raise AssertionError("off-center collider should fail publication")
except ValueError as error:
    assert "centered on its object origin" in str(error)
bpy.data.objects.remove(off_center, do_unlink=True)

tilted = cube("tilted", (0, 5, 0), (1, 1, 1), role="platform")
tilted.rotation_euler.x = 0.1
try:
    addon.level_publication(scene)
    raise AssertionError("tilted gameplay transform should fail publication")
except ValueError as error:
    assert "upright" in str(error)
bpy.data.objects.remove(tilted, do_unlink=True)

waypoints = [child for child in moving.children_recursive if child.get("fpp2_waypoint", False)]
for waypoint in waypoints:
    waypoint["fpp2_waypoint"] = False
curve_data = bpy.data.curves.new("Platform path", "CURVE")
curve_data.dimensions = "3D"
spline = curve_data.splines.new("POLY")
spline.points.add(1)
spline.points[0].co = (4, 0, 2, 1)
spline.points[1].co = (6, 0, 2, 1)
curve = bpy.data.objects.new("Platform path", curve_data)
scene.collection.objects.link(curve)
curve.parent = moving
curve.matrix_parent_inverse = moving.matrix_world.inverted()
curve["fpp2_path"] = True
bpy.context.view_layer.update()
assert addon.motion_data(moving, scene) == [[0.0, 0.0, 0.0], [2.0, 0.0, 0.0]]
bpy.data.objects.remove(curve, do_unlink=True)
bpy.data.curves.remove(curve_data)
for waypoint in waypoints:
    waypoint["fpp2_waypoint"] = True

publication = addon.level_publication(scene)
assert addon.level_publication(scene) == publication
expected = os.environ.get("FPP2_PUBLICATION_PATH", "/tmp/fpp2-blender-publication.json")
with open(expected, "w", encoding="utf-8") as stream:
    json.dump(publication, stream, separators=(",", ":"))

level = publication["level"]
by_id = {obj["id"]: obj for obj in level["objects"]}
assert by_id["moving-platform"]["transform"]["position"] == [4.0, 2.0, 0.0]
assert all(abs(actual - expected) < 1e-5 for actual, expected in zip(by_id["moving-platform"]["transform"]["scale"], [2.0, 0.5, 1.0]))
assert by_id["moving-platform"]["transform"]["rotation"][1] > 0
assert by_id["moving-platform"]["motion"]["path"] == [[0.0, 0.0, 0.0], [2.0, 0.0, 0.0]]
assert by_id["moving-platform"]["motion"]["phase"] == 0.25
assert by_id["moving-platform"]["crumble"]["returnDelay"] == 3
assert by_id["moving-platform"]["surface"] == {"profile": "ice", "overrides": {"traction": 0.2}}
assert by_id["shallow-slope"]["collision"] == {"kind": "slope", "dimensions": [2.0, 1.0, 2.0], "rise": 0.4}
assert by_id["goal"]["collision"]["kind"] == "trigger-box"
assert by_id["checkpoint"]["collision"]["kind"] == "trigger-box"
assert level["spawnPosition"] == [0.0, 2.0, 0.0]
assert by_id["ground"]["transform"]["position"] == [1.0, 0.0, 0.0]
assert level["scenery"][0]["asset"] in publication["assets"]
for asset in publication["assets"]:
    assert asset.startswith("blender-") and len(asset) == 72

addon.register()
scene.fpp2_url = os.environ.get("FPP2_PUBLISH_URL", "http://127.0.0.1:5173/__blender/publish")
scene.fpp2_publish_on_save = bool(os.environ.get("FPP2_PUBLISH_URL"))
blend_path = os.environ.get("FPP2_BLEND_PATH", "/tmp/fpp2-blender-test.blend")

# The save handler publishes from Edit Mode and restores the user's working mode.
bpy.ops.object.select_all(action="DESELECT")
ground_visual.select_set(True)
bpy.context.view_layer.objects.active = ground_visual
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.transform.translate(value=(0, 0, 0.01))
edited_publication = addon.level_publication(scene)
assert bpy.context.mode == "EDIT_MESH"
assert edited_publication["assets"] != publication["assets"]
bpy.ops.wm.save_as_mainfile(filepath=blend_path)
assert bpy.context.mode == "EDIT_MESH"
if os.environ.get("FPP2_PUBLISH_URL"):
    assert scene.get("fpp2_last_status", "").startswith("Published successfully"), scene.get("fpp2_last_status")
bpy.ops.object.mode_set(mode="OBJECT")
print(f"FPP2 fixture exported to {expected}")
