bl_info = {
    "name": "FPP2 level publisher",
    "author": "FPP2",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "category": "Import-Export",
}

import hashlib
import json
import math
import os
import tempfile
import urllib.request

import bpy
from mathutils import Matrix, Quaternion


GAME_FROM_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))


def game_position(value):
    return [float(value[0]), float(value[2]), float(-value[1])]


def game_rotation(value):
    value = value.copy()
    value.normalize()
    x, y, z = value.to_euler("XYZ")
    if abs(x) > 1e-5 or abs(y) > 1e-5:
        raise ValueError("Gameplay objects and scenery may rotate around Blender Z only")
    half = z * 0.5
    return [0.0, math.sin(half), 0.0, math.cos(half)]


def identifier(value):
    result = "".join(character.lower() if character.isalnum() else "-" for character in value).strip("-")
    while "--" in result:
        result = result.replace("--", "-")
    if not result or not result[0].isalnum():
        raise ValueError("Object names must produce a valid level identifier")
    return result


def vector(value):
    return [float(value[0]), float(value[1]), float(value[2])]


def transform(obj):
    if any(component <= 0 for component in obj.scale):
        raise ValueError(f"{obj.name}: transform scale must be positive")
    return {
        "position": game_position(obj.location),
        "rotation": game_rotation(obj.rotation_quaternion if obj.rotation_mode == "QUATERNION" else obj.rotation_euler.to_quaternion()),
        "scale": [float(obj.scale.x), float(obj.scale.z), float(obj.scale.y)],
    }


def evaluated_vertices(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        return [vertex.co.copy() for vertex in mesh.vertices], [tuple(poly.vertices) for poly in mesh.polygons], [material for material in mesh.materials]
    finally:
        evaluated.to_mesh_clear()


def proxy_bounds(obj, slope_rise=None):
    vertices, _, _ = evaluated_vertices(obj)
    if not vertices:
        raise ValueError(f"{obj.name}: collision proxy has no mesh vertices")
    lows = [min(vertex[axis] for vertex in vertices) for axis in range(3)]
    highs = [max(vertex[axis] for vertex in vertices) for axis in range(3)]
    dimensions = [highs[0] - lows[0], highs[2] - lows[2], highs[1] - lows[1]]
    if slope_rise is not None:
        dimensions = json.loads(obj.get("fpp2_dimensions", "null"))
        if not isinstance(dimensions, list) or len(dimensions) != 3 or any(not isinstance(value, (int, float)) or value <= 0 for value in dimensions):
            raise ValueError(f"{obj.name}: slope requires fpp2_dimensions as [width, height, depth]")
        width, height, depth = dimensions
        expected = {(x, x * slope_rise / width + y, z) for x in (-width / 2, width / 2) for y in (-height / 2, height / 2) for z in (-depth / 2, depth / 2)}
        actual = {(vertex[0], vertex[2], -vertex[1]) for vertex in vertices}
        if len(vertices) != 8 or any(not any(all(abs(component - expected_component) <= 1e-5 for component, expected_component in zip(point, corner)) for corner in expected) for point in actual):
            raise ValueError(f"{obj.name}: slope proxy vertices must match fpp2_dimensions and fpp2_rise")
        return [float(value) for value in dimensions]
    if any(value <= 0 for value in dimensions):
        raise ValueError(f"{obj.name}: collision proxy must have positive dimensions")
    expected = {(x, y, z) for x in (lows[0], highs[0]) for y in (lows[2], highs[2]) for z in (-highs[1], -lows[1])}
    actual = {(round(vertex[0], 6), round(vertex[2], 6), round(-vertex[1], 6)) for vertex in vertices}
    if len(vertices) != 8 or actual != {(round(x, 6), round(y, 6), round(z, 6)) for x, y, z in expected}:
        raise ValueError(f"{obj.name}: collision proxy must have exactly eight box corners")
    return dimensions


def export_asset(root, visual_objects, directory):
    if not visual_objects:
        raise ValueError(f"{root.name}: mark at least one child fpp2_visual_only or set fpp2_visual_only on the root")
    created_objects = []
    created_meshes = []
    previous_selection = list(bpy.context.selected_objects)
    previous_active = bpy.context.view_layer.objects.active
    try:
        inverse_root = root.matrix_world.inverted()
        for source in visual_objects:
            vertices, faces, materials = evaluated_vertices(source)
            relative = GAME_FROM_BLENDER @ inverse_root @ source.matrix_world
            converted = [relative @ vertex for vertex in vertices]
            mesh = bpy.data.meshes.new(f"{source.name}_export")
            mesh.from_pydata(converted, [], faces)
            for material in materials:
                mesh.materials.append(material)
            mesh.update()
            obj = bpy.data.objects.new(f"{source.name}_export", mesh)
            bpy.context.scene.collection.objects.link(obj)
            created_meshes.append(mesh)
            created_objects.append(obj)
        bpy.ops.object.select_all(action="DESELECT")
        for obj in created_objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = created_objects[0]
        path = os.path.join(directory, "asset.glb")
        result = bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=False)
        if "FINISHED" not in result:
            raise ValueError("Blender glTF export did not finish")
        with open(path, "rb") as stream:
            data = stream.read()
        asset = "blender-" + hashlib.sha256(data).hexdigest()
        return asset, data
    finally:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in created_objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        for mesh in created_meshes:
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
        for obj in previous_selection:
            if bpy.data.objects.get(obj.name) is not None:
                obj.select_set(True)
        if previous_active is not None and bpy.data.objects.get(previous_active.name) is not None:
            bpy.context.view_layer.objects.active = previous_active


def authored_objects(scene):
    return [obj for obj in scene.objects if obj.type == "MESH" and obj.get("fpp2_role") in {"ground", "platform", "goal", "checkpoint"}]


def visual_parts(root):
    if root.get("fpp2_visual_only", False):
        return [root]
    return [child for child in root.children_recursive if child.type == "MESH" and child.get("fpp2_visual_only", False)]


def level_publication(scene):
    objects = authored_objects(scene)
    if sum(obj.get("fpp2_role") == "ground" for obj in objects) != 1:
        raise ValueError("Mark exactly one mesh object with fpp2_role = ground")
    assets = {}
    level_objects = []
    with tempfile.TemporaryDirectory(prefix="fpp2-blender-") as directory:
        for obj in objects:
            role = obj["fpp2_role"]
            collision_kind = obj.get("fpp2_collision", "trigger-box" if role in {"goal", "checkpoint"} else "box")
            if role in {"goal", "checkpoint"}:
                if collision_kind != "trigger-box":
                    raise ValueError(f"{obj.name}: goal and checkpoint collision must be trigger-box")
                collision = {"kind": "trigger-box", "dimensions": proxy_bounds(obj)}
            else:
                if collision_kind not in {"box", "slope"}:
                    raise ValueError(f"{obj.name}: solid collision must be box or slope")
                if collision_kind == "slope":
                    rise = float(obj.get("fpp2_rise", 0.0))
                    if not math.isfinite(rise) or rise == 0:
                        raise ValueError(f"{obj.name}: slope requires a finite nonzero fpp2_rise")
                    dimensions = proxy_bounds(obj, rise)
                else:
                    dimensions = proxy_bounds(obj)
                collision = {"kind": collision_kind, "dimensions": dimensions}
                if collision_kind == "slope":
                    collision["rise"] = rise
                if role == "platform" and obj.get("fpp2_mode") in {"solid", "one-way"}:
                    collision["mode"] = obj["fpp2_mode"]
            asset, data = export_asset(obj, visual_parts(obj), directory)
            assets[asset] = data
            item = {
                "id": identifier(obj.get("fpp2_id", obj.name)),
                "role": role,
                "transform": transform(obj),
                "visual": {"kind": "gltf", "asset": asset},
                "collision": collision,
            }
            if role == "platform" and obj.get("fpp2_mode") in {"solid", "one-way"}:
                item["collision"]["mode"] = obj["fpp2_mode"]
            if role == "platform" and obj.get("fpp2_motion_path"):
                path = json.loads(obj["fpp2_motion_path"])
                item["motion"] = {
                    "path": [game_position(point) for point in path],
                    "duration": float(obj.get("fpp2_motion_duration", 1.0)),
                    "phase": float(obj.get("fpp2_motion_phase", 0.0)),
                    "mode": obj.get("fpp2_motion_mode", "loop"),
                }
            if role == "platform" and "fpp2_crumble_delay" in obj:
                item["crumble"] = {"delay": float(obj["fpp2_crumble_delay"])}
                if "fpp2_crumble_return_delay" in obj:
                    item["crumble"]["returnDelay"] = float(obj["fpp2_crumble_return_delay"])
            if "fpp2_surface" in obj:
                item["surface"] = json.loads(obj["fpp2_surface"])
            level_objects.append(item)
        scenery = []
        for obj in scene.objects:
            if obj.type != "MESH" or not obj.get("fpp2_scenery", False):
                continue
            asset, data = export_asset(obj, visual_parts(obj) or [obj], directory)
            assets[asset] = data
            scenery.append({"id": identifier(obj.get("fpp2_id", obj.name)), "asset": asset, "transform": transform(obj)})
    spawn = game_position(scene.get("fpp2_spawn_position", (0.0, 0.0, 2.0)))
    level = {
        "id": identifier(scene.get("fpp2_level", "blender-level")),
        "spawnPosition": spawn,
        "failureBoundaryY": float(scene.get("fpp2_failure_y", -20.0)),
        "objects": level_objects,
    }
    if scenery:
        level["scenery"] = scenery
    test_from = scene.get("fpp2_test_from")
    import base64
    publication = {"level": level, "assets": {asset: base64.b64encode(data).decode("ascii") for asset, data in assets.items()}}
    if test_from:
        publication["testFrom"] = identifier(test_from)
    return publication


def publish(scene):
    publication = level_publication(scene)
    payload = json.dumps(publication, separators=(",", ":")).encode("utf-8")
    url = scene.get("fpp2_url", "http://127.0.0.1:5173/__blender/publish")
    request = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.loads(response.read().decode("utf-8"))
    print(f"FPP2 published {result.get('id')} revision {result.get('revision')}")
    return result


def on_save(_):
    scene = bpy.context.scene
    if scene is None or not scene.get("fpp2_publish_on_save", True):
        return
    try:
        publish(scene)
    except Exception as error:
        print(f"FPP2 publish failed: {error}")


def register():
    if on_save not in bpy.app.handlers.save_post:
        bpy.app.handlers.save_post.append(on_save)


def unregister():
    if on_save in bpy.app.handlers.save_post:
        bpy.app.handlers.save_post.remove(on_save)


if __name__ == "__main__":
    register()
