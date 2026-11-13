# FPP2

FPP2 is a first-person pogo platform game built with Shallot. The player steers and changes pole length to land on platforms, charge launches, and reach each level goal.

## Run

```sh
bun install
bun run dev
```

Open the local Vite URL in a browser with WebGPU support. `bun check` runs the TypeScript check and production build.

## Controls

- `WASD`: steer in the camera direction
- Hold `Space` during contact to charge; release to launch. Some surfaces launch automatically or cap the charge.
- `E` / `Q`: extend / retract the pole when the level enables pole length
- `R`: restart at the current checkpoint; `Shift+R`: restart at the level spawn
- Click the game and move the pointer to orbit; scroll to zoom
- `H`: show or hide the controls

## Levels

The campaign starts at the latest unlocked level and advances when you reach a goal. In development, load a level by adding `?level=<id>` to the URL, for example `?level=ice-slide-practice`. The id must match a JSON file in `public/levels`.

In development, `?editor=1` opens the level editor. See [LEVELS.md](LEVELS.md) for the level file format and editor workflow.
