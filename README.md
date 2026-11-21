# Bodycam Corridor

An interactive 3D portfolio presented as a first-person, bodycam-style experience. Walk through a yard and a haunted corridor house, and explore themed rooms that showcase the work inside.

Built with [Three.js](https://threejs.org/) and [Vite](https://vitejs.dev/).

## Features

- First-person exploration with a found-footage bodycam HUD (REC indicator, battery, date stamp, chromatic text glow)
- Portfolio content presented as rooms, each with its own theme
- Procedural textures and synthesized audio
- Desktop and mobile support (touch controls)
- Automated end-to-end tests with Playwright

## Getting started

Requires Node.js 18+.

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite.

## Scripts

| Command           | Description                          |
| ----------------- | ------------------------------------ |
| `npm run dev`     | Start the dev server                 |
| `npm run build`   | Create a production build in `dist/` |
| `npm run preview` | Preview the production build         |
| `npm test`        | Run the Playwright tests             |

## Project structure

```
index.html          Page shell and HUD styles
src/main.js         Scene setup, controls, game loop
src/portfolio.js    Portfolio rooms and content
src/roomThemes.js   Per-room visual themes
src/textures.js     Procedural textures
src/audio.js        Sound
tests/              Playwright specs (desktop, mobile, HUD, house)
public/             Static assets and icons
```

## Tech stack

- Three.js 0.170
- Vite 5
- Playwright
