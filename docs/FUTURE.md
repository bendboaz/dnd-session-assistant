# Local notes & minor fixes

The backlog and all independently-actionable work live in **GitHub Issues**:
<https://github.com/bendboaz/dnd-session-assistant/issues>

This is the single local file for small notes and quick fixes that aren't worth a
dedicated issue. Anything an independent contributor could pick up should be an
**issue** instead, not a bullet here.

## Dev gotchas (toolchain / this machine)

- The Vite dev server can wedge on Windows under tooling — prefer running `npm run dev`
  in a real terminal you control, and kill stray `node`/`esbuild` processes if a port
  stays locked.
- `npm create vite@latest` (v9) scaffolds a vanilla (non-React) template — verify the
  toolchain after scaffolding.
- Vite dev proxy must target `127.0.0.1` (not `localhost`) since uvicorn binds IPv4 and
  `localhost` can resolve to IPv6 `::1`.

## Minor fixes / TODO

_(none right now — see GitHub Issues for tracked work)_
