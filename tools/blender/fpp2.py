bl_info = {
    "name": "FPP2 level publisher",
    "author": "FPP2",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "category": "Import-Export",
}

import base64
import hashlib
import json
import math
import os
import tempfile
import urllib.error
import urllib.request

import bpy
from bpy.app.handlers import persistent
from mathutils import Matrix, Vector


GAME_FROM_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
EPSILON = 1e-5


def game_position(value):
    return [float(value[0]), float(value[2]), float(-value[1])]


def game_rotation(value):
    value = value.copy()
    value.normalize()
    x, y, z = value.to_euler("XYZ")
    if abs(x) > EPSILON or abs(y) > EPSILON:
        raise ValueError("Gameplay objects must be upright and may rotate around Blender Z only")
    half = z * 0.5
    return [0.0, math.sin(half), 0.0, math.cos(half)]


def identifier(value):
    result = "".join(character.lower() if character.isascii() and character.isalnum() else "-" for character in value).strip("-")
    while "--" in result:
        result = result.replace("--", "-")
    if not result or not result[0].isalnum():
        raise ValueError("Names must produce a valid level identifier")
    return result


def world_transform(obj):
    matrix = obj.matrix_world.copy()
    location, rotation, scale = matrix.decompose()
    if any(not math.isfinite(component) or component <= 0 for component in scale):
        raise ValueError(f"{obj.name}: gameplay world scale must be finite and positive")
    reconstructed = Matrix.LocRotScale(location, rotation, scale)
    if any(abs(matrix[row][column] - reconstructed[row][column]) > EPSILON for row in range(4) for column in range(4)):
        raise ValueError(f"{obj.name}: gameplay transform contains shear")
    return {
        "position": game_position(location),
        "rotation": game_rotation(rotation),
        "scale": [float(scale.x), float(scale.z), float(scale.y)],
    }


def evaluated_mesh(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    try:
        if not mesh.vertices or not mesh.polygons:
            raise ValueError(f"{obj.name}: visual mesh is empty")
        return mesh.copy()
    finally:
        evaluated.to_mesh_clear()


def proxy_vertices(obj):
    mesh = evaluated_mesh(obj)
    try:
        return [vertex.co.copy() for vertex in mesh.vertices]
    finally:
        bpy.data.meshes.remove(mesh)


def proxy_bounds(obj, slope_rise=None):
    vertices = proxy_vertices(obj)
    lows = [min(vertex[axis] for vertex in vertices) for axis in range(3)]
    highs = [max(vertex[axis] for vertex in vertices) for axis in range(3)]
    dimensions = [highs[0] - lows[0], highs[2] - lows[2], highs[1] - lows[1]]
    if any(value <= EPSILON or not math.isfinite(value) for value in dimensions):
        raise ValueError(f"{obj.name}: collision proxy must have positive finite dimensions")
    if any(abs(lows[axis] + highs[axis]) > EPSILON for axis in range(3)):
        raise ValueError(f"{obj.name}: collision proxy must be centered on its object origin")
    if slope_rise is not None:
        dimensions = obj.get("fpp2_dimensions")
        if isinstance(dimensions, (str, bytes)) or dimensions is None or len(dimensions) != 3 or any(not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0 for value in dimensions):
            raise ValueError(f"{obj.name}: slope requires fpp2_dimensions as [width, height, depth]")
        width, height, depth = dimensions
        expected = {(x, x * slope_rise / width + y, z) for x in (-width / 2, width / 2) for y in (-height / 2, height / 2) for z in (-depth / 2, depth / 2)}
        actual = {(round(vertex[0], 6), round(vertex[2], 6), round(-vertex[1], 6)) for vertex in vertices}
        if len(vertices) != 8 or actual != {(round(x, 6), round(y, 6), round(z, 6)) for x, y, z in expected}:
            raise ValueError(f"{obj.name}: slope proxy vertices must match fpp2_dimensions and fpp2_rise")
        return [float(value) for value in dimensions]
    expected = {(x, y, z) for x in (lows[0], highs[0]) for y in (lows[2], highs[2]) for z in (-highs[1], -lows[1])}
    actual = {(round(vertex[0], 6), round(vertex[2], 6), round(-vertex[1], 6)) for vertex in vertices}
    if len(vertices) != 8 or actual != {(round(x, 6), round(y, 6), round(z, 6)) for x, y, z in expected}:
        raise ValueError(f"{obj.name}: collision proxy must have exactly eight axis-aligned box corners")
    return dimensions


def export_asset(root, visual_objects, directory, bake_world=False):
    if not visual_objects:
        raise ValueError(f"{root.name}: add a child mesh marked fpp2_visual_only")
    created_objects = []
    created_meshes = []
    previous_selection = list(bpy.context.selected_objects)
    previous_active = bpy.context.view_layer.objects.active
    try:
        inverse_root = Matrix.Identity(4) if bake_world else root.matrix_world.inverted()
        for source in visual_objects:
            mesh = evaluated_mesh(source)
            relative = GAME_FROM_BLENDER @ inverse_root @ source.matrix_world
            if relative.to_3x3().determinant() < 0:
                mesh.flip_normals()
            mesh.transform(relative, shape_keys=False)
            obj = bpy.data.objects.new(f"{source.name}_export", mesh)
            bpy.context.scene.collection.objects.link(obj)
            created_meshes.append(mesh)
            created_objects.append(obj)
        bpy.ops.object.select_all(action="DESELECT")
        for obj in created_objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = created_objects[0]
        path = os.path.join(directory, "asset.glb")
        result = bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=False, export_yup=False)
        if "FINISHED" not in result:
            raise ValueError("Blender glTF export did not finish")
        with open(path, "rb") as stream:
            data = stream.read()
        return "blender-" + hashlib.sha256(data).hexdigest(), data
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
    parts = [root] if root.type == "MESH" and root.get("fpp2_visual_only", False) else []
    parts.extend(child for child in root.children_recursive if child.type == "MESH" and child.get("fpp2_visual_only", False))
    return parts


def surface_data(obj):
    if "fpp2_surface_profile" not in obj:
        return None
    surface = {"profile": obj["fpp2_surface_profile"]}
    overrides = {}
    for key in ("bounceScale", "restitution", "impactSpeedLimit", "momentumRetention", "contactDrag",
                "traction", "minimumDwell", "directionalSpeed", "chargeScale", "maximumVerticalSpeed", "holdMode"):
        prop = f"fpp2_surface_{key}"
        if prop in obj:
            overrides[key] = obj[prop]
    if overrides:
        surface["overrides"] = overrides
    if surface["profile"] == "directional":
        direction = obj.get("fpp2_surface_direction", [1.0, 0.0])
        surface["directionXZ"] = list(direction)
    return surface


def motion_data(obj, scene):
    paths = [item for item in scene.objects if item.type == "CURVE" and item.parent == obj and item.get("fpp2_path", False)]
    if len(paths) > 1:
        raise ValueError(f"{obj.name}: use exactly one movement curve")
    if paths:
        curve = paths[0]
        if len(curve.data.splines) != 1 or curve.data.splines[0].type != "POLY" or len(curve.data.splines[0].points) < 2:
            raise ValueError(f"{curve.name}: movement requires one POLY spline with at least two points")
        if any(child.type == "EMPTY" and child.get("fpp2_waypoint", False) for child in obj.children_recursive):
            raise ValueError(f"{obj.name}: use a movement curve or waypoints")
        origin = obj.matrix_world.translation
        return [game_position(curve.matrix_world @ Vector((point.co.x, point.co.y, point.co.z)) - origin) for point in curve.data.splines[0].points]
    waypoints = [child for child in obj.children_recursive if child.type == "EMPTY" and child.get("fpp2_waypoint", False)]
    if waypoints:
        waypoints.sort(key=lambda item: (int(item.get("fpp2_order", 0)), item.name))
        origin = obj.matrix_world.translation
        return [game_position(item.matrix_world.translation - origin) for item in waypoints]
    return None


def spawn_position(scene):
    spawns = [obj for obj in scene.objects if obj.type == "EMPTY" and obj.get("fpp2_role") == "spawn"]
    if len(spawns) != 1:
        raise ValueError("Mark exactly one Empty object with fpp2_role = spawn")
    return game_position(spawns[0].matrix_world.translation)


def _level_publication(scene):
    objects = authored_objects(scene)
    if sum(obj.get("fpp2_role") == "ground" for obj in objects) != 1:
        raise ValueError("Mark exactly one mesh object with fpp2_role = ground")
    assets = {}
    level_objects = []
    with tempfile.TemporaryDirectory(prefix="fpp2-blender-") as directory:
        for obj in objects:
            role = obj["fpp2_role"]
            item_transform = world_transform(obj)
            collision_kind = obj.get("fpp2_collision", "trigger-box" if role in {"goal", "checkpoint"} else "box")
            if role in {"goal", "checkpoint"}:
                if collision_kind != "trigger-box":
                    raise ValueError(f"{obj.name}: goal and checkpoint collision must be trigger-box")
                collision = {"kind": "trigger-box", "dimensions": proxy_bounds(obj)}
            else:
                if collision_kind not in {"box", "slope"}:
                    raise ValueError(f"{obj.name}: solid collision must be box or slope")
                rise = None
                if collision_kind == "slope":
                    rise = float(obj.get("fpp2_rise", 0.0))
                    if not math.isfinite(rise) or rise == 0:
                        raise ValueError(f"{obj.name}: slope requires a finite nonzero fpp2_rise")
                    dimensions = obj.get("fpp2_dimensions")
                    if isinstance(dimensions, (str, bytes)) or dimensions is None or len(dimensions) != 3 or not all(isinstance(value, (int, float)) and math.isfinite(value) and value > 0 for value in dimensions):
                        raise ValueError(f"{obj.name}: slope requires fpp2_dimensions as [width, height, depth]")
                    if abs(rise / dimensions[0]) > 0.35:
                        raise ValueError(f"{obj.name}: slope grade exceeds the supported limit of 0.35")
                dimensions = proxy_bounds(obj, rise)
                collision = {"kind": collision_kind, "dimensions": dimensions}
                if collision_kind == "slope":
                    collision["rise"] = rise
                if role == "platform" and obj.get("fpp2_mode") in {"solid", "one-way"}:
                    collision["mode"] = obj["fpp2_mode"]
            asset, data = export_asset(obj, visual_parts(obj), directory)
            assets[asset] = data
            item = {"id": identifier(obj.get("fpp2_id", obj.name)), "role": role,
                    "transform": item_transform, "visual": {"kind": "gltf", "asset": asset}, "collision": collision}
            motion_path = motion_data(obj, scene) if role == "platform" else None
            if motion_path:
                if any(abs(value) > EPSILON for value in motion_path[0]):
                    raise ValueError(f"{obj.name}: the first waypoint must coincide with the platform origin")
                motion_path[0] = [0.0, 0.0, 0.0]
                item["motion"] = {"path": motion_path,
                                  "duration": float(obj.get("fpp2_motion_duration", 1.0)),
                                  "phase": float(obj.get("fpp2_motion_phase", 0.0)),
                                  "mode": obj.get("fpp2_motion_mode", "loop")}
            if role == "platform" and "fpp2_crumble_delay" in obj:
                item["crumble"] = {"delay": float(obj["fpp2_crumble_delay"])}
                if "fpp2_crumble_return_delay" in obj:
                    item["crumble"]["returnDelay"] = float(obj["fpp2_crumble_return_delay"])
            surface = surface_data(obj)
            if surface is not None:
                item["surface"] = surface
            level_objects.append(item)
        scenery = []
        for obj in scene.objects:
            if obj.type != "MESH" or not obj.get("fpp2_scenery", False):
                continue
            asset, data = export_asset(obj, list(dict.fromkeys([obj] + visual_parts(obj))), directory, bake_world=True)
            assets[asset] = data
            scenery.append({"id": identifier(obj.get("fpp2_id", obj.name)), "asset": asset,
                            "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0, 1.0], "scale": [1.0, 1.0, 1.0]}})
    level = {"id": identifier(scene.get("fpp2_level", "blender-level")),
             "spawnPosition": spawn_position(scene),
             "failureBoundaryY": float(scene.get("fpp2_failure_y", -20.0)),
             "objects": level_objects}
    if scenery:
        level["scenery"] = scenery
    publication = {"level": level, "assets": {asset: base64.b64encode(data).decode("ascii") for asset, data in assets.items()}}
    test_from = scene.get("fpp2_test_from")
    if test_from:
        publication["testFrom"] = identifier(test_from)
    return publication


def level_publication(scene):
    previous_mode = bpy.context.mode
    restore_mode = "EDIT" if previous_mode.startswith("EDIT_") else previous_mode
    previous_active = bpy.context.view_layer.objects.active
    previous_selection = list(bpy.context.selected_objects)
    if previous_mode != "OBJECT" and previous_active is not None:
        bpy.ops.object.mode_set(mode="OBJECT")
    try:
        return _level_publication(scene)
    finally:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in previous_selection:
            if bpy.data.objects.get(obj.name) is not None:
                obj.select_set(True)
        if previous_active is not None and bpy.data.objects.get(previous_active.name) is not None:
            bpy.context.view_layer.objects.active = previous_active
            if restore_mode != "OBJECT":
                bpy.ops.object.mode_set(mode=restore_mode)


def publish(scene):
    publication = level_publication(scene)
    payload = json.dumps(publication, separators=(",", ":")).encode("utf-8")
    url = getattr(scene, "fpp2_url", scene.get("fpp2_url", "http://127.0.0.1:5173/__blender/publish"))
    request = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        try:
            message = json.loads(error.read().decode("utf-8")).get("error", str(error))
        except (ValueError, UnicodeError):
            message = str(error)
        raise ValueError(message) from error
    print(f"FPP2 published {result.get('id')} revision {result.get('revision')}")
    return result


@persistent
def on_save(_):
    scene = bpy.context.scene
    if scene is None or not getattr(scene, "fpp2_publish_on_save", scene.get("fpp2_publish_on_save", True)):
        return
    try:
        publish(scene)
        scene["fpp2_last_status"] = "Published successfully"
    except Exception as error:
        scene["fpp2_last_status"] = f"Publish failed: {error}"
        print(f"FPP2 publish failed: {error}")


class FPP2_OT_publish(bpy.types.Operator):
    bl_idname = "fpp2.publish"
    bl_label = "Publish Level"

    def execute(self, context):
        try:
            if "fpp2_test_from" in context.scene:
                del context.scene["fpp2_test_from"]
            result = publish(context.scene)
            context.scene["fpp2_last_status"] = f"Published revision {result.get('revision')}"
            self.report({"INFO"}, context.scene["fpp2_last_status"])
            return {"FINISHED"}
        except Exception as error:
            context.scene["fpp2_last_status"] = f"Publish failed: {error}"
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}


class FPP2_OT_test_selected(bpy.types.Operator):
    bl_idname = "fpp2.test_selected"
    bl_label = "Test from Selected Platform"

    def execute(self, context):
        obj = context.active_object
        while obj is not None and (obj.type != "MESH" or obj.get("fpp2_role") != "platform"):
            obj = obj.parent
        if obj is None or obj.type != "MESH" or obj.get("fpp2_role") != "platform":
            self.report({"ERROR"}, "Select a platform mesh or one of its visual children")
            return {"CANCELLED"}
        context.scene["fpp2_test_from"] = obj.get("fpp2_id", obj.name)
        try:
            result = publish(context.scene)
            context.scene["fpp2_last_status"] = f"Test started at {obj.name}; revision {result.get('revision')}"
            self.report({"INFO"}, context.scene["fpp2_last_status"])
            return {"FINISHED"}
        except Exception as error:
            context.scene["fpp2_last_status"] = f"Publish failed: {error}"
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}


class FPP2_PT_publisher(bpy.types.Panel):
    bl_label = "FPP2"
    bl_idname = "FPP2_PT_publisher"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "FPP2"

    def draw(self, context):
        layout = self.layout
        layout.prop(context.scene, "fpp2_publish_on_save")
        layout.prop(context.scene, "fpp2_url")
        layout.operator("fpp2.publish")
        layout.operator("fpp2.test_selected")
        if context.scene.get("fpp2_test_from"):
            layout.label(text=f"Start: {context.scene['fpp2_test_from']}")
        layout.label(text=context.scene.get("fpp2_last_status", "Ready"))


CLASSES = (FPP2_OT_publish, FPP2_OT_test_selected, FPP2_PT_publisher)


def register():
    bpy.types.Scene.fpp2_publish_on_save = bpy.props.BoolProperty(name="Publish on Save", default=True)
    bpy.types.Scene.fpp2_url = bpy.props.StringProperty(name="Publish URL", default="http://127.0.0.1:5173/__blender/publish")
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    if on_save not in bpy.app.handlers.save_post:
        bpy.app.handlers.save_post.append(on_save)


def unregister():
    if on_save in bpy.app.handlers.save_post:
        bpy.app.handlers.save_post.remove(on_save)
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
    del bpy.types.Scene.fpp2_publish_on_save
    del bpy.types.Scene.fpp2_url


if __name__ == "__main__":
    register()
