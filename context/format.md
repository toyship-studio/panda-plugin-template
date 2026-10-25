# The plugin format

The reference for this repository, condensed from the book chapter "Writing a plugin"
(https://pandaengine.dev/docs/plugins/), which is the canonical text. A plugin is data the editor
reads: nothing in it executes.

## The archive

- A zip of at most 50 MB with the plugin folder as its single root entry (`tools/validate-plugin.mjs`
  packs it that way; `tools/`, `context/`, `.github/` and the agent files stay out).
- At the root only `plugin.json`, `data/`, `README.md`, `CHANGELOG.md`, `LICENSE`/`LICENSE.txt`/
  `LICENSE.md`, `icon.png` (PNG, at most 1 MB) and `screenshots/` (png, jpeg or webp, at most 5 MB
  each, at most eight).
- Under `data/` only kind folders: `themes/`, `icons/`. Unknown folders are an error.
- No symbolic links, executables or libraries (`.exe .dll .so .dylib .sh .bat .cmd .com .msi .app
  .jar .ps1 .scr`), no paths outside the folder.

## plugin.json

| Field | Required | Rule |
|---|---|---|
| `manifestVersion` | yes | `1` |
| `id` | yes | reverse domain, at least three lowercase segments of `[a-z0-9-]`; inside your portal namespace (`io.github.<login>.*`); never changes |
| `name` | yes | at most 120 characters |
| `version` | yes | semver `x.y.z`, optional `-tag`; immutable once published |
| `description` | yes | one line, at most 500 characters |
| `license` | yes | an SPDX id such as `MIT`, at most 64 characters |
| `engine` | yes | a semver range the editor version must satisfy: `^0.1.0`, `>=0.1.0 <0.3.0`, `0.1.x`, `*` |
| `parts` | yes | `["data"]` |
| `authors` | | strings `"Name <mail>"` |
| `category` | | one lowercase word: `themes`, `ui`, `editor`, `tools`, `localization` |
| `tags` | | at most ten words of `[a-z0-9-]`, up to 32 characters |
| `links` | | `repository`, `homepage`, `issues` — `https://` only |
| `unlisted` | | `true` hides the plugin from the catalog; it still installs by id |

## Themes — `data/themes/<file>.json`

```json
{ "name": "Sunset", "base": "dark", "colors": { "accent": "#F9A445" } }
```

`base` is `dark` or `light`; `colors` overrides fields of the base. Values: `#RRGGBB`, `#RRGGBBAA`,
`#RGB`, `#RGBA`. The theme id is `<plugin id>/<file name without .json>`. The fields (dark values of
the built-in Panda Dark):

| Field | Dark | Paints |
|---|---|---|
| `windowBackground` | `#141414` | the base background of the editor and the panels |
| `surface` | `#1E1E1E` | toolbar, menus and popups, dialogs, the active tab, cards |
| `surfaceVariant` | `#191918` | the menu bar, tab strips, a focused text field |
| `input` | `#1B1B1B` | input fields, X/Y/Z cells, asset previews |
| `inputDeep` | `#161616` | the search field, panel status bars |
| `textPrimary` | `#E6E6E6` | main text, active values |
| `textSecondary` | `#CFCFCF` | regular rows, readable secondary content |
| `textMuted` | `#969696` | field labels, icons at rest, counters |
| `textDim` | `#6E6E6E` | captions, placeholders, metadata, chevrons |
| `textDisabled` | `#595959` | inactive or hidden entities |
| `accent` | `#45A9F9` | the primary action: buttons, the active segment, links |
| `accentHover` | `#6FC1FF` | the accent under the cursor |
| `accentPressed` | derived | the accent while pressed |
| `onAccent` | `#06121F` | text on a solid accent button |
| `accentSecondary` | `#12B69D` | the secondary accent (selected segment of a segmented control) |
| `accentText` | `#9ECBFF` | text and icons on an accent backing, outline buttons |
| `accentSoft` | `#45A9F929` | the backing of the active tab, icon or toggle |
| `accentMutedSurface` | `#1F2A36` | the background of an outline primary button |
| `accentMutedBorder` | `#2C4156` | the border of an outline primary button |
| `control` | `#2B2B2B` | neutral buttons, icon hover, tags |
| `controlHover` | `#353637` | a neutral control under the cursor |
| `controlPressed` | `#232323` | a neutral control while pressed |
| `border` | `#303030` | borders between large zones (toolbar, panels) |
| `borderMed` | `#2A2A2A` | input fields, cards |
| `borderSoft` | `#262626` | panel header separators |
| `borderFaint` | `#1F1F1F` | row separators in lists, logs and tables |
| `borderStrong` | `#3A3A3A` | the border of a field under the cursor |
| `focusRing` | `#6FC1FF` | the focus ring |
| `knob` | | the toggle knob and the slider handle |
| `textSelection` | | the text selection highlight (semi-transparent) |
| `selection` | | a selected row or cell while the list has the focus |
| `selectionInactive` | | the same when the list has no focus |
| `rowHover` | | the row or cell under the cursor (barely visible) |
| `success` | | status: success |
| `warning` | | status: warning |
| `danger` | | status: danger, destructive buttons |

## Icons — `data/icons/<name>.png`

PNG white alpha masks (the shape is the alpha channel, RGB white; the editor tints them), at most
256 KB each; 48×48 for editor icons, 168×168 for the file previews. The file name is the icon name;
the plugin replaces that icon everywhere while it is installed. Names of the current preview:

| Group | Names |
|---|---|
| Transport and edits | `play`, `stop`, `simulate`, `undo`, `redo`, `save`, `reload`, `export`, `plus`, `clear`, `copy`, `trash`, `more-h` |
| Gizmo | `gizmo-move`, `gizmo-rotate`, `gizmo-scale`, `space-local`, `space-world`, `maximize`, `restore` |
| Navigation | `home`, `folder`, `folder-open`, `chevron-left`, `chevron-right`, `chevron-up` |
| Objects and assets | `entity-cube`, `light-sun`, `light-point`, `camera`, `mesh`, `material`, `sprite`, `script`, `audio`, `globe` |
| Status | `info`, `warning`, `error` |
| Settings and tools | `tune`, `configure`, `hammer`, `plugins` |
| Panels | `panel-hierarchy`, `panel-inspector`, `panel-content-browser`, `panel-asset-manager`, `panel-output`, `panel-statistics`, `panel-profiler`, `panel-world-settings`, `panel-viewport`, `panel-cmake`, `panel-bottom-dock` |
| File previews (168×168) | `file`, `file-png`, `file-cpp`, `asset-world`, `prefab` |
| Terrain module | `terrain`, `flora-tree`, `flora-bush`, `flora-grass-mesh`, `flora-tuft`, `flora-rock` |

The originals are in the engine repository, `PandaEditor/resources/ui/editor-icons/` and
`ui/file-icons/`: draw on the same canvas with the same margins.

## Problem codes

The validator and the portal report the same codes: `ROOT_NOT_SINGLE`, `ROOT_ENTRY_UNEXPECTED`,
`PATH_INVALID`, `SYMLINK`, `EXECUTABLE`, `MANIFEST_MISSING`, `MANIFEST_INVALID`,
`MANIFEST_VERSION_UNSUPPORTED`, `ID_INVALID`, `VERSION_INVALID`, `ENGINE_RANGE_INVALID`,
`PARTS_UNSUPPORTED`, `NAME_REQUIRED`, `DESCRIPTION_REQUIRED`, `LICENSE_REQUIRED`, `AUTHORS_INVALID`,
`TAGS_INVALID`, `CATEGORY_INVALID`, `LINKS_INVALID`, `UNLISTED_INVALID`, `DATA_MISSING`,
`DATA_ENTRY_UNEXPECTED`, `DATA_KIND_UNKNOWN`, `THEME_FILE_INVALID`, `THEME_NAME_REQUIRED`,
`THEME_BASE_INVALID`, `THEME_COLORS_INVALID`, `THEME_COLOR_UNKNOWN`, `THEME_COLOR_INVALID`,
`ICON_FILE_INVALID`, `ICON_FILE_TOO_LARGE`, `ICON_TOO_LARGE`, `ICON_INVALID`, `SCREENSHOT_INVALID`,
`SCREENSHOT_TOO_LARGE`, `SCREENSHOT_TOO_MANY`. On upload the portal adds `VERSION_EXISTS` (409),
`NAMESPACE_FORBIDDEN` (403) and `UNAUTHORIZED` (401).
