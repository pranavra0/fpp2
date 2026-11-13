import importlib.util
import json
import math
import os
import sys

import bpy
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
    obj["fpp2_dimensions"] = json.dumps(dimensions)
    obj["fpp2_rise"] = rise
    return obj


clear_scene()
scene = bpy.context.scene
scene["fpp2_level"] = "blender-check"
scene["fpp2_spawn_position"] = [0, 0, 2]
scene["fpp2_failure_y"] = -12
scene["fpp2_test_from"] = "moving-platform"

material = bpy.data.materials.new("Test material")
material.diffuse_color = (0.3, 0.6, 0.2, 1)

ground = cube("ground", (0, 0, 0), (5, 0.5, 5), role="ground")
visual_child(ground, "ground visual", (0, 0, 0.5), (5, 0.25, 5), material)

moving = cube("moving platform", (4, 0, 2), (1, 0.5, 1), role="platform")
moving.rotation_euler.z = math.pi / 4
moving.scale = (2, 1, 0.5)
moving["fpp2_motion_path"] = json.dumps([[0, 0, 0], [2, 0, 0]])
moving["fpp2_motion_duration"] = 4
moving["fpp2_motion_phase"] = 0.25
moving["fpp2_motion_mode"] = "ping-pong"
moving["fpp2_crumble_delay"] = 1.5
moving["fpp2_crumble_return_delay"] = 3
visual_child(moving, "moving visual", (4, 0, 3.2), (1, 0.4, 0.5), material)

slope = slope_proxy("shallow slope", (7, 0, 0.5), [2, 1, 2], 0.4)
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

publication = addon.level_publication(scene)
expected = os.environ.get("FPP2_PUBLICATION_PATH", "/tmp/fpp2-blender-publication.json")
with open(expected, "w", encoding="utf-8") as stream:
    json.dump(publication, stream, separators=(",", ":"))

level = publication["level"]
by_id = {obj["id"]: obj for obj in level["objects"]}
assert by_id["moving-platform"]["transform"]["position"] == [4.0, 2.0, 0.0]
assert by_id["moving-platform"]["transform"]["scale"] == [2.0, 0.5, 1.0]
assert by_id["moving-platform"]["transform"]["rotation"][1] > 0
assert by_id["moving-platform"]["motion"]["phase"] == 0.25
assert by_id["moving-platform"]["crumble"]["returnDelay"] == 3
assert by_id["shallow-slope"]["collision"] == {"kind": "slope", "dimensions": [2.0, 1.0, 2.0], "rise": 0.4}
assert by_id["goal"]["collision"]["kind"] == "trigger-box"
assert by_id["checkpoint"]["collision"]["kind"] == "trigger-box"
assert level["scenery"][0]["asset"] in publication["assets"]
for asset in publication["assets"]:
    assert asset.startswith("blender-") and len(asset) == 72

scene["fpp2_url"] = os.environ.get("FPP2_PUBLISH_URL", "http://127.0.0.1:5173/__blender/publish")
scene["fpp2_publish_on_save"] = bool(os.environ.get("FPP2_PUBLISH_URL"))
addon.register()
blend_path = os.environ.get("FPP2_BLEND_PATH", "/tmp/fpp2-blender-test.blend")
bpy.ops.wm.save_as_mainfile(filepath=blend_path)
print(f"FPP2 fixture exported to {expected}")
