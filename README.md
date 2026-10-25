# Panda plugin template

The starting point of a plugin for the [Panda](https://pandaengine.dev) editor: a theme, a set of
editor icons, or both. Press **Use this template** on GitHub, clone your new repository and run

```
node tools/init.mjs
```

It asks for the name, your GitHub login (the plugin id becomes `io.github.<login>.<slug>`), what the
plugin provides, the license and the author, and writes `plugin.json`, the data folders, `README.md`,
`CHANGELOG.md` and `LICENSE`. Node 20 or newer, nothing to install. This README is replaced by the
plugin's own page.

## Then

1. **Work on it in the editor.** Window → Plugins → **Install Dev Plugin** → this folder. The card
   is marked Dev; a theme applies from its button, icons change at once; after an edit press
   **Reload** on the card.
2. **Check.** `node tools/validate-plugin.mjs . --zip plugin.zip` — the rules of the registry, with
   the codes the portal reports. The `Check` workflow runs it on every push.
3. **Publish.** Make a publish token on pandaengine.dev (Account → Tokens) and add it to the
   repository secrets as `PANDA_PUBLISH_TOKEN`; then `git tag v0.1.0 && git push --tags` — the
   `Publish` workflow checks the archive and uploads it. From this machine:
   `PANDA_PUBLISH_TOKEN=pnd_… node tools/publish.mjs .`
4. **Update.** Raise `version` in `plugin.json`, add the `CHANGELOG.md` entry, tag again. Published
   versions are immutable; a broken one is yanked on the portal (Account → My plugins).

## What is where

| Path | What |
|---|---|
| `plugin.json` | the manifest: id, name, version, description, license, engine range, what it provides |
| `data/themes/*.json` | themes: a base (`dark` or `light`) and the colors it overrides |
| `data/icons/*.png` | editor icons by name: white alpha masks, 48×48 (file previews 168×168) |
| `icon.png` | the icon of the plugin itself (256×256), shown on the card and the plugin page |
| `README.md`, `CHANGELOG.md`, `LICENSE`, `screenshots/` | the plugin page on the portal |
| `tools/` | `init.mjs`, `validate-plugin.mjs`, `publish.mjs` — not part of the archive |
| `context/format.md` | the format reference: manifest fields, theme colors, icon names |
| `AGENTS.md`, `CLAUDE.md`, `.claude/skills/` | instructions for coding agents working in this repository |
| `.github/workflows/` | `check.yml` on every push, `publish.yml` on a version tag |

The archive holds only `plugin.json`, `data/`, `README.md`, `CHANGELOG.md`, `LICENSE*`, `icon.png`
and `screenshots/`; everything else in the repository is left out by the packer.

The full guide is the book chapter [Writing a plugin](https://pandaengine.dev/docs/plugins/).
