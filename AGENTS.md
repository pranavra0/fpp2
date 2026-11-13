# Shallot project

## Persistent task constraints

- Use plain technical wording only. No flavor text, jokes, emojis, themed names, or marketing language in code, comments, logs, or replies.
- All UI elements should be barebones "in development" in feeling - avoid aestheticizing things, keep it baseline usable and ignore the rest - function over form
- Do exactly the requested task. Do not add unrelated features, files, abstractions, configs, READMEs, or docs.
- For simulation code, use TypeScript, plain typed objects, and free functions. Do not use classes, inheritance, getters/setters, dependency injection, or event systems.
- Simulation code must not import Shallot, rendering, input devices, camera, or UI. It may accept plain typed controls and collision results from engine integration. Keep collision queries and level geometry outside the simulation; keep movement and contact response pure.
- Comments explain why only. Do not add TODO comments. Use assertions for invariants; do not clamp invalid state to hide it.
- delete every tests except algorithmic logic, boundary IO, and integration flows
- Dont worry about inspecting the browser yourself, the user will test manually 

## Shallot Specific notes
Explore this project's entry, plugins and checks first; reuse its setup.

- Learn the API from the installed package, not memory. `bunx shallot create --help` lists the examples in `node_modules/@dylanebert/shallot/examples/`; start from the nearest one, its implementation and its checks, then the JSDoc in `node_modules/@dylanebert/shallot/src/` for the APIs it uses.
- Check your work as that example's checks do, with the cheapest evidence that answers: state, then a captured frame, then the browser.
- For editor changes, verify level and collision state with the focused integration test, exercise authoring and persistence in a development browser, and report when the available GPU prevents visual scene verification.
- While you iterate, run only the check that answers your change: `bun test ./<file>` or `bunx playwright test <file>`. Before you finish, run `bun check` and `bun test` once; CI, `.github/workflows/test.yml`, runs every tier.
- `bun test` runs `*.test.ts` and `*.gpu.test.ts` only; run a `*.node.ts` check by path with `bun test ./<file>`. A full renderer or physics composition is a `tests/<goal>.node.ts` check, not a `*.gpu.test.ts`.


---

## Project Specific notes

- look at /docs/ , gitignored with personal notes and things

- follow standard ECS design
