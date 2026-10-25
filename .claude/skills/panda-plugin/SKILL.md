---
name: panda-plugin
description: Work on a Panda editor plugin in this repository — set it up, add a theme or icons, check the archive, publish a version. Use when the user asks to create, change, validate or publish the plugin, add a theme, recolor the editor, or replace editor icons.
---

# Panda plugin

The repository is a data plugin of the Panda editor (`AGENTS.md`, `context/format.md`). Everything
below runs with Node 20+, without dependencies.

## Set up a fresh copy of the template

`node tools/init.mjs` asks for the name, the GitHub login (the id becomes `io.github.<login>.<slug>`),
the description, the kinds (themes, icons), the license and the author, and writes `plugin.json`,
`data/…`, `README.md`, `CHANGELOG.md`, `LICENSE`. Non-interactive:
`node tools/init.mjs --name "Sunset" --login yourname --kinds themes,icons --license MIT --author "Name <mail>" --description "…" --yes`.

## Add or change a theme

- One file per theme in `data/themes/<file>.json`: `{"name": "…", "base": "dark" | "light", "colors": {…}}`.
- `colors` keys are the 36 fields listed in `context/format.md` (with what each one paints);
  values are hex colors `#RRGGBB`, `#RRGGBBAA`, `#RGB`, `#RGBA`. Unnamed fields keep the base value.
- Start from the accent group (`accent`, `accentHover`, `accentText`, `accentSoft`) and the
  surfaces (`windowBackground`, `surface`, `surfaceVariant`, `input`, `inputDeep`), then borders and
  text.
- Keep the file name once published: the theme id is `<plugin id>/<file name>`.

## Add or change icons

- `data/icons/<token>.png`, where `<token>` is an icon name from the table in
  `context/format.md`. White alpha masks (the shape is the alpha channel, RGB white): the editor
  tints them. 48×48 for editor icons, 168×168 for the file previews. At most 256 KB each.
- The editor replaces the icon with that name everywhere as soon as the plugin is installed or
  reloaded, and restores its own when the plugin is removed.

## Check

`node tools/validate-plugin.mjs . --zip plugin.zip` — exit 0 with `OK <id>@<version> provides [...]`,
or exit 1 with one line per problem: `CODE (path): message`. Fix every line; the portal applies the
same rules.

## Publish

1. Raise `version` in `plugin.json` (semver) and add the entry to `CHANGELOG.md`.
2. Either push a tag (`git tag v1.2.0 && git push --tags`; the Publish workflow needs the
   repository secret `PANDA_PUBLISH_TOKEN`), or run
   `PANDA_PUBLISH_TOKEN=pnd_… node tools/publish.mjs .` locally.
3. A published version cannot be changed; a broken one is yanked on the portal (Account → My
   plugins). Never commit the token or `plugin.zip`.

## Test in the editor

Window → Plugins → Install Dev Plugin → this folder. Press the theme's button on the card to apply
it; after edits press Reload. Uninstall removes only the link.
