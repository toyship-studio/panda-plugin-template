#!/usr/bin/env node
// The first setup of a plugin made from the template. Asks a few questions — or takes them as
// flags — and writes plugin.json, the data folders, README.md, CHANGELOG.md and LICENSE. Safe to
// run again: the manifest that exists is the default for every answer, and a kind that is added
// gets its folder. Node 20 or newer, no dependencies.
//
//   node tools/init.mjs
//   node tools/init.mjs --name "Sunset" --login yourname --kinds themes,icons --license MIT \
//       --author "Your Name <you@example.com>" --description "A warm dark theme." --yes
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { packFolder, validateArchive } from "./validate-plugin.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLACEHOLDER_ID = "io.github.your-login.your-plugin";
const KINDS = ["themes", "icons"];
const LICENSES = ["MIT", "Apache-2.0", "CC0-1.0"];
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?){2,}$/;
const WORD = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// ---------- flags ----------

function parseFlags(argv) {
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith("--")) continue;
        const key = arg.slice(2);
        if (key === "yes" || key === "help") { flags[key] = true; continue; }
        flags[key] = argv[i + 1];
        i++;
    }
    return flags;
}

function git(command) {
    try {
        return execSync(`git ${command}`, { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
        return "";
    }
}

function slugOf(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// git@github.com:a/b.git and https://github.com/a/b.git → https://github.com/a/b
function repositoryUrl() {
    const remote = git("remote get-url origin");
    const match = remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    return match ? `https://github.com/${match[1]}/${match[2]}` : "";
}

function readJson(file) {
    try {
        return JSON.parse(readFileSync(file, "utf8"));
    } catch {
        return null;
    }
}

// ---------- questions ----------

async function main() {
    const flags = parseFlags(process.argv.slice(2));
    if (flags.help) {
        console.log("Usage: node tools/init.mjs [--name N] [--login L | --id I] [--slug S] [--description D] [--kinds themes,icons]\n" +
            "       [--license MIT|Apache-2.0|CC0-1.0|<SPDX>] [--author \"Name <mail>\"] [--base dark|light] [--theme-name T]\n" +
            "       [--engine ^0.1.0] [--yes]   (--yes: no questions, defaults and flags only)");
        return 0;
    }
    const existing = readJson(join(root, "plugin.json"));
    const fresh = !existing || existing.id === PLACEHOLDER_ID;
    const rl = flags.yes ? null : createInterface({ input: stdin, output: stdout });
    const ask = async (question, fallback, check) => {
        while (true) {
            const answer = rl ? (await rl.question(`${question}${fallback ? ` [${fallback}]` : ""}: `)).trim() || fallback : fallback;
            const problem = check ? check(answer) : null;
            if (!problem) return answer;
            if (!rl) throw new Error(`${question}: ${problem}`);
            console.log(`  ${problem}`);
        }
    };
    const required = (what) => (value) => (value ? null : `${what} is required`);

    console.log(fresh ? "A new Panda plugin. Press Enter to accept a default.\n" : `Updating ${existing.id}. Press Enter to keep a value.\n`);

    const name = await ask("Plugin name", flags.name ?? (fresh ? "" : existing.name), required("The name"));
    let id;
    if (flags.id) {
        id = flags.id;
    } else if (!fresh && !flags.login && !flags.slug) {
        id = existing.id;
    } else {
        const loginDefault = flags.login ?? (repositoryUrl().match(/github\.com\/([^/]+)/)?.[1] ?? "");
        const login = (await ask("Your GitHub login (the id becomes io.github.<login>.<slug>)", loginDefault, required("The login"))).toLowerCase();
        const slug = await ask("Plugin slug", flags.slug ?? slugOf(name), (value) => (WORD.test(value) ? null : "lowercase letters, digits and dashes"));
        id = `io.github.${login}.${slug}`;
    }
    if (!ID_PATTERN.test(id)) throw new Error(`The id "${id}" is not a reverse domain of at least three lowercase segments`);
    const description = await ask("One-line description", flags.description ?? (fresh ? "" : existing.description), required("The description"));
    const kindsText = await ask("What it provides (themes, icons)", flags.kinds ?? (fresh ? "themes" : KINDS.filter((kind) => existsSync(join(root, "data", kind))).join(",") || "themes"), (value) => {
        const kinds = value.split(",").map((kind) => kind.trim()).filter(Boolean);
        return kinds.length > 0 && kinds.every((kind) => KINDS.includes(kind)) ? null : `one or more of: ${KINDS.join(", ")}`;
    });
    const kinds = kindsText.split(",").map((kind) => kind.trim()).filter(Boolean);
    let themeName = "", base = "dark";
    if (kinds.includes("themes") && !existsSync(join(root, "data", "themes", `${slugOf(name)}.json`))) {
        themeName = await ask("Theme name", flags["theme-name"] ?? name, required("The theme name"));
        base = await ask("Theme base (dark or light)", flags.base ?? "dark", (value) => (value === "dark" || value === "light" ? null : "dark or light"));
    }
    const license = await ask(`License (${LICENSES.join(", ")} or another SPDX id)`, flags.license ?? (fresh ? "MIT" : existing.license), required("The license"));
    const authorDefault = flags.author ?? (fresh
        ? [git("config user.name"), git("config user.email") ? `<${git("config user.email")}>` : ""].filter(Boolean).join(" ")
        : (existing.authors ?? []).join(", "));
    const author = await ask("Author (Name <mail>)", authorDefault);
    const engine = await ask("Engine version range", flags.engine ?? (fresh ? "^0.1.0" : existing.engine), required("The engine range"));
    rl?.close();

    // ---------- the manifest ----------
    const manifest = {
        manifestVersion: 1,
        id,
        name,
        version: fresh ? "0.1.0" : existing.version,
        description,
        license,
        engine,
        parts: ["data"],
        authors: author ? author.split(",").map((item) => item.trim()).filter(Boolean) : [],
        category: kinds.includes("themes") ? "themes" : "ui",
        tags: Array.from(new Set([...(fresh ? [] : existing.tags ?? []), ...kinds.map((kind) => (kind === "themes" ? "theme" : kind))])),
        links: { ...(fresh ? {} : existing.links ?? {}) },
        unlisted: fresh ? false : Boolean(existing.unlisted),
    };
    const repository = repositoryUrl();
    if (repository && !manifest.links.repository) manifest.links.repository = repository;
    if (Object.keys(manifest.links).length === 0) delete manifest.links;
    writeFileSync(join(root, "plugin.json"), formatManifest(manifest));

    // ---------- the data ----------
    const written = ["plugin.json"];
    if (kinds.includes("themes")) {
        const themesDir = join(root, "data", "themes");
        mkdirSync(themesDir, { recursive: true });
        const file = join(themesDir, `${slugOf(name)}.json`);
        if (!existsSync(file)) {
            writeFileSync(file, JSON.stringify({ name: themeName || name, base, colors: {} }, null, 4) + "\n");
            written.push(`data/themes/${slugOf(name)}.json`);
        }
    }
    if (kinds.includes("icons")) {
        mkdirSync(join(root, "data", "icons"), { recursive: true });
    }

    // ---------- the pages ----------
    if (fresh || !existsSync(join(root, "README.md"))) {
        writeFileSync(join(root, "README.md"), readme(manifest, kinds));
        written.push("README.md");
    }
    if (fresh || !existsSync(join(root, "CHANGELOG.md"))) {
        writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\n## 0.1.0 — unreleased\n\n- First version.\n");
        written.push("CHANGELOG.md");
    }
    if (fresh || !existsSync(join(root, "LICENSE"))) {
        writeFileSync(join(root, "LICENSE"), licenseText(license, manifest.authors[0] ?? "The authors"));
        written.push("LICENSE");
    }
    console.log(`\nWritten: ${written.join(", ")}`);

    // ---------- the check ----------
    const packed = packFolder(root);
    const report = packed.buffer ? validateArchive(packed.buffer) : null;
    if (report?.valid) {
        console.log(`Check: OK ${report.manifest.id}@${report.manifest.version} provides [${report.provides.join(", ")}]`);
    } else if (report) {
        for (const problem of report.problems) console.log(`Check: ${problem.code}${problem.path ? ` (${problem.path})` : ""}: ${problem.message}`);
    }
    if (kinds.includes("icons") && !(report?.provides ?? []).includes("icons")) {
        console.log("Icons: put PNG masks named after the editor icons into data/icons/ (the names are in context/format.md).");
    }
    console.log(`\nNext:
  1. Replace icon.png (256×256) and write README.md as the plugin page.
  2. In the editor: Window → Plugins → Install Dev Plugin → this folder; edit, then Reload on the card.
  3. Check: node tools/validate-plugin.mjs . --zip plugin.zip
  4. Publish: a publish token from pandaengine.dev (Account → Tokens) as the repository secret
     PANDA_PUBLISH_TOKEN, then git tag v${manifest.version} && git push --tags — or
     PANDA_PUBLISH_TOKEN=pnd_… node tools/publish.mjs .`);
    return 0;
}

// JSON with four spaces and short arrays on one line: "parts": ["data"].
function formatManifest(manifest) {
    return JSON.stringify(manifest, null, 4).replace(/\[\n\s+((?:"[^"\n]*",?\n\s+)+)\]/g, (match, items) => {
        const inline = items.trim().split(/,\n\s+/).map((item) => item.trim()).join(", ");
        return inline.length <= 72 ? `[${inline}]` : match;
    }) + "\n";
}

function readme(manifest, kinds) {
    const lines = [`# ${manifest.name}`, "", manifest.description, ""];
    if (kinds.includes("themes")) lines.push("## Themes", "", `The themes of this plugin are the files in \`data/themes/\`; each one is a button on the plugin card in the editor.`, "");
    if (kinds.includes("icons")) lines.push("## Icons", "", "The icons in `data/icons/` replace the editor icons with the same names.", "");
    lines.push(
        "## Install",
        "",
        `In the Panda editor open Window → Plugins and search for **${manifest.name}**, or open the plugin page: https://pandaengine.dev/plugins/${manifest.id}`,
        "",
        "## Development",
        "",
        "Window → Plugins → Install Dev Plugin → this folder; after an edit press Reload on the card.",
        "`node tools/validate-plugin.mjs . --zip plugin.zip` checks the archive with the rules of the registry;",
        "`node tools/publish.mjs .` publishes it with the token of `PANDA_PUBLISH_TOKEN`. The format is described in",
        "`context/format.md` and in the docs: https://pandaengine.dev/docs/plugins/",
        "",
        "## License",
        "",
        `${manifest.license}, see LICENSE.`,
        ""
    );
    return lines.join("\n");
}

function licenseText(license, holder) {
    const year = new Date().getFullYear();
    if (license === "MIT") {
        return `MIT License

Copyright (c) ${year} ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
    }
    const links = { "Apache-2.0": "https://www.apache.org/licenses/LICENSE-2.0.txt", "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt" };
    return `${license}

Copyright (c) ${year} ${holder}

Replace this file with the full text of the ${license} license${links[license] ? `: ${links[license]}` : ""}.
`;
}

main().then((code) => process.exit(code), (error) => {
    console.error(error.message);
    process.exit(1);
});
