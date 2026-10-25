# Working on this plugin

This repository is a Panda editor plugin: a folder of data the editor reads, with a manifest
(`plugin.json`) and a `data/` folder whose subfolders say what the plugin provides. The format,
the fields and the rules are in `context/format.md`; the canonical guide is the book chapter
"Writing a plugin" at https://pandaengine.dev/docs/plugins/.

- A plugin carries no code: nothing under `data/` executes, and no script, library or executable
  goes into the archive. Themes are JSON, icons are PNG masks.
- The id in `plugin.json` never changes: it names the installed folder, the page on the portal and
  the setting that remembers a chosen theme. The theme id is `<plugin id>/<file name>`, so renaming
  a theme file resets the choice of everyone who uses it.
- Every published version is immutable. Raise `version` and add a `CHANGELOG.md` entry for every
  change that is published.
- Only `plugin.json`, `data/`, `README.md`, `CHANGELOG.md`, `LICENSE*`, `icon.png` and
  `screenshots/` go into the archive; `tools/`, `context/`, `.github/`, this file and the editor
  files stay out of it (the packer leaves them out).

Commands (Node 20 or newer, no dependencies):

- `node tools/init.mjs` — the first setup: name, id, kinds, license; writes the manifest, the data
  folders, README, CHANGELOG and LICENSE. Run it again to add a kind.
- `node tools/validate-plugin.mjs . --zip plugin.zip` — the rules of the registry, with the same
  codes the portal reports; writes the archive.
- `PANDA_PUBLISH_TOKEN=pnd_… node tools/publish.mjs .` — check, pack and publish from this machine.
  `--dry-run` checks only.
- The workflows do the same: `check.yml` on every push, `publish.yml` on a `v*` tag with the
  repository secret `PANDA_PUBLISH_TOKEN`.

Testing in the editor: Window → Plugins → Install Dev Plugin → this folder. The card is marked Dev;
a theme applies from its button, icons change at once; after an edit press Reload on the card.
Problems with a file go to the Output panel of the editor.
