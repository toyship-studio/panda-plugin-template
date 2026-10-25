#!/usr/bin/env node
// Validates a Panda plugin archive or folder with the rules of the registry (docs/api.md).
// Dependency free: a small zip reader on top of node:zlib so authors can run it anywhere.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, lstatSync, writeFileSync } from "node:fs";
import { basename, join, posix, relative, resolve } from "node:path";
import { inflateRawSync, deflateRawSync } from "node:zlib";

const LIMITS = {
    archiveBytes: 50 * 1024 * 1024,
    unpackedBytes: 200 * 1024 * 1024,
    entries: 5000,
    iconBytes: 1024 * 1024,
    iconFileBytes: 256 * 1024, // one editor icon of data/icons/
    screenshotBytes: 5 * 1024 * 1024,
    screenshots: 8,
    descriptionLength: 500,
    nameLength: 120,
};
const ROOT_FILES = new Set(["plugin.json", "README.md", "CHANGELOG.md", "LICENSE", "LICENSE.txt", "LICENSE.md", "icon.png"]);
const ROOT_FOLDERS = new Set(["data", "screenshots"]);
const DATA_KINDS = new Set(["themes", "icons"]);
const EXECUTABLE_EXTENSIONS = new Set([".exe", ".dll", ".so", ".dylib", ".sh", ".bat", ".cmd", ".com", ".msi", ".app", ".jar", ".ps1", ".scr"]);
const THEME_BASES = new Set(["dark", "light"]);
const THEME_COLORS = new Set([
    "windowBackground", "surface", "surfaceVariant", "input", "inputDeep",
    "textPrimary", "textSecondary", "textMuted", "textDim", "textDisabled",
    "accent", "accentHover", "accentPressed", "onAccent", "accentSecondary", "accentText", "accentSoft",
    "accentMutedSurface", "accentMutedBorder",
    "control", "controlHover", "controlPressed",
    "border", "borderMed", "borderSoft", "borderFaint", "borderStrong", "focusRing",
    "knob", "textSelection", "selection", "selectionInactive", "rowHover",
    "success", "warning", "danger",
]);
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?){2,}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const RANGE_PATTERN = /^(\*|x|(?:(?:\^|~|>=|<=|>|<|=)?\s*\d+(?:\.(?:\d+|x|\*))?(?:\.(?:\d+|x|\*))?(?:-[0-9A-Za-z.-]+)?)(?:\s+(?:(?:\^|~|>=|<=|>|<|=)?\s*\d+(?:\.(?:\d+|x|\*))?(?:\.(?:\d+|x|\*))?(?:-[0-9A-Za-z.-]+)?))*)(?:\s*\|\|\s*(?:\*|x|(?:(?:\^|~|>=|<=|>|<|=)?\s*\d+(?:\.(?:\d+|x|\*))?(?:\.(?:\d+|x|\*))?(?:-[0-9A-Za-z.-]+)?)(?:\s+(?:(?:\^|~|>=|<=|>|<|=)?\s*\d+(?:\.(?:\d+|x|\*))?(?:\.(?:\d+|x|\*))?(?:-[0-9A-Za-z.-]+)?))*))*$/;
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// ---------- zip reading ----------

function readZip(buffer) {
    if (buffer.length > LIMITS.archiveBytes) {
        throw new ValidationError("ARCHIVE_TOO_LARGE", `The archive is larger than ${LIMITS.archiveBytes / 1024 / 1024} MB`);
    }
    let eocd = -1;
    for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new ValidationError("ARCHIVE_UNREADABLE", "Not a zip archive");
    const count = buffer.readUInt16LE(eocd + 10);
    const directoryOffset = buffer.readUInt32LE(eocd + 16);
    if (count > LIMITS.entries) throw new ValidationError("ARCHIVE_TOO_MANY_ENTRIES", `More than ${LIMITS.entries} entries`);
    const entries = [];
    let offset = directoryOffset;
    let unpacked = 0;
    for (let i = 0; i < count; i++) {
        if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new ValidationError("ARCHIVE_UNREADABLE", "Corrupt central directory");
        const versionMadeBy = buffer.readUInt16LE(offset + 4);
        const method = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const size = buffer.readUInt32LE(offset + 24);
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const externalAttributes = buffer.readUInt32LE(offset + 38);
        const localOffset = buffer.readUInt32LE(offset + 42);
        const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
        const unixMode = (versionMadeBy >> 8) === 3 ? (externalAttributes >>> 16) & 0xffff : 0;
        unpacked += size;
        if (unpacked > LIMITS.unpackedBytes) throw new ValidationError("ARCHIVE_TOO_LARGE", "Unpacked size exceeds the limit");
        entries.push({
            name, size, method, unixMode,
            isDirectory: name.endsWith("/"),
            isSymlink: (unixMode & 0o170000) === 0o120000,
            isExecutable: (unixMode & 0o111) !== 0 && (unixMode & 0o170000) !== 0o040000,
            read() {
                const header = localOffset;
                if (buffer.readUInt32LE(header) !== 0x04034b50) throw new ValidationError("ARCHIVE_UNREADABLE", `Corrupt entry ${name}`);
                const localNameLength = buffer.readUInt16LE(header + 26);
                const localExtraLength = buffer.readUInt16LE(header + 28);
                const start = header + 30 + localNameLength + localExtraLength;
                const data = buffer.subarray(start, start + compressedSize);
                if (method === 0) return Buffer.from(data);
                if (method === 8) return inflateRawSync(data, { maxOutputLength: LIMITS.unpackedBytes });
                throw new ValidationError("ARCHIVE_UNREADABLE", `Unsupported compression in ${name}`);
            },
        });
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

// ---------- zip writing (folder → archive, store + deflate) ----------

function crc32(buffer) {
    let crc = ~0;
    for (const byte of buffer) {
        crc ^= byte;
        for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return ~crc >>> 0;
}

function writeZip(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
    const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
    for (const { name, data } of files) {
        const nameBuffer = Buffer.from(name, "utf8");
        const compressed = deflateRawSync(data);
        const useDeflate = compressed.length < data.length;
        const payload = useDeflate ? compressed : data;
        const crc = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
        local.writeUInt16LE(useDeflate ? 8 : 0, 8); local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12);
        local.writeUInt32LE(crc, 14); local.writeUInt32LE(payload.length, 18); local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuffer.length, 26); local.writeUInt16LE(0, 28);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x031e, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
        central.writeUInt16LE(useDeflate ? 8 : 0, 10); central.writeUInt16LE(dosTime, 12); central.writeUInt16LE(dosDate, 14);
        central.writeUInt32LE(crc, 16); central.writeUInt32LE(payload.length, 20); central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBuffer.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
        central.writeUInt32LE(offset, 42);
        locals.push(local, nameBuffer, payload);
        centrals.push(central, nameBuffer);
        offset += local.length + nameBuffer.length + payload.length;
    }
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
    return Buffer.concat([...locals, directory, end]);
}

// Folder mode packs only what the archive may hold at its root (ROOT_FILES, ROOT_FOLDERS): the
// tools, workflows and notes a repository keeps next to the plugin stay out of the archive instead
// of failing it. .DS_Store is skipped everywhere.
function isAllowedRootEntry(item, isDirectory) {
    if (isDirectory) return ROOT_FOLDERS.has(item);
    return ROOT_FILES.has(item) || /^LICENSE/.test(item);
}

function folderToEntries(folder) {
    const root = basename(resolve(folder));
    const files = [];
    const leftOut = [];
    const walk = (dir, atRoot) => {
        for (const item of readdirSync(dir).sort()) {
            if (item === ".DS_Store") continue;
            const full = join(dir, item);
            const stat = lstatSync(full);
            if (atRoot && !isAllowedRootEntry(item, stat.isDirectory())) {
                leftOut.push(stat.isDirectory() ? `${item}/` : item);
                continue;
            }
            const name = posix.join(root, relative(folder, full).split("\\").join("/"));
            if (stat.isSymbolicLink()) {
                files.push({ name, data: Buffer.alloc(0), symlink: true });
            } else if (stat.isDirectory()) {
                walk(full, false);
            } else {
                files.push({ name, data: readFileSync(full), executable: (stat.mode & 0o111) !== 0 });
            }
        }
    };
    walk(folder, true);
    return { files, leftOut };
}

// The archive of a plugin folder. bad: the first symbolic link or executable (the archive is not
// written then); leftOut: the root entries that are not part of a plugin.
export function packFolder(folder) {
    const { files, leftOut } = folderToEntries(folder);
    const bad = files.find((entry) => entry.symlink || entry.executable) ?? null;
    return { buffer: bad ? null : writeZip(files), leftOut, bad };
}

// ---------- validation ----------

class ValidationError extends Error {
    constructor(code, message, path) { super(message); this.code = code; this.path = path; }
}

function validateEntries(entries) {
    const problems = [];
    const problem = (code, message, path) => problems.push({ code, message, path });
    const files = new Map();
    let root = null;
    for (const entry of entries) {
        const name = entry.name;
        if (name.includes("\\") || name.startsWith("/") || name.split("/").includes("..") || name.split("/").includes(".")) {
            problem("PATH_INVALID", "Paths must be relative and inside the plugin folder", name);
            continue;
        }
        const segments = name.split("/").filter(Boolean);
        if (segments.length === 0) continue;
        if (root === null) root = segments[0];
        if (segments[0] !== root) {
            problem("ROOT_NOT_SINGLE", `Expected one root folder, found "${segments[0]}" next to "${root}"`, name);
            continue;
        }
        if (entry.isSymlink) { problem("SYMLINK", "Symbolic links are not allowed", name); continue; }
        if (entry.isDirectory) continue;
        const inner = segments.slice(1).join("/");
        if (!inner) { problem("ROOT_NOT_SINGLE", "Files must live inside the plugin folder", name); continue; }
        const extension = posix.extname(inner).toLowerCase();
        if (entry.isExecutable || EXECUTABLE_EXTENSIONS.has(extension)) {
            problem("EXECUTABLE", "Executable files are not allowed", inner);
            continue;
        }
        files.set(inner, entry);
    }
    if (files.size === 0) {
        problem("ARCHIVE_EMPTY", "The archive has no files");
        return { problems, manifest: null, provides: [] };
    }
    for (const inner of files.keys()) {
        const top = inner.split("/")[0];
        const isFolder = inner.includes("/");
        if (!isFolder && !ROOT_FILES.has(top) && !/^LICENSE/.test(top)) problem("ROOT_ENTRY_UNEXPECTED", "Unexpected file at the plugin root", inner);
        if (isFolder && !ROOT_FOLDERS.has(top)) problem("ROOT_ENTRY_UNEXPECTED", "Unexpected folder at the plugin root", inner);
    }
    const manifestEntry = files.get("plugin.json");
    let manifest = null;
    if (!manifestEntry) {
        problem("MANIFEST_MISSING", "plugin.json is missing", "plugin.json");
    } else {
        try {
            manifest = JSON.parse(manifestEntry.read().toString("utf8"));
        } catch {
            problem("MANIFEST_INVALID", "plugin.json is not valid JSON", "plugin.json");
        }
    }
    if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) {
        validateManifest(manifest, problem);
    } else if (manifest !== null) {
        problem("MANIFEST_INVALID", "plugin.json must be an object", "plugin.json");
        manifest = null;
    }
    const provides = new Set();
    let hasData = false;
    for (const [inner, entry] of files) {
        const parts = inner.split("/");
        if (parts[0] === "data") {
            hasData = true;
            const kind = parts[1];
            if (parts.length < 3) { problem("DATA_ENTRY_UNEXPECTED", "Files under data/ live in a kind folder such as data/themes/", inner); continue; }
            if (!DATA_KINDS.has(kind)) { problem("DATA_KIND_UNKNOWN", `Unknown data kind "${kind}"`, inner); continue; }
            if (kind === "themes") {
                if (parts.length !== 3 || !inner.endsWith(".json")) { problem("THEME_FILE_INVALID", "Themes are JSON files directly under data/themes/", inner); continue; }
                validateTheme(entry, inner, problem);
                provides.add("themes");
            } else if (kind === "icons") {
                // Editor icons: PNG masks named after the icon tokens, directly under data/icons/.
                if (parts.length !== 3 || !inner.endsWith(".png")) problem("ICON_FILE_INVALID", "Icons are PNG files directly under data/icons/", inner);
                else if (entry.size > LIMITS.iconFileBytes) problem("ICON_FILE_TOO_LARGE", "An icon is larger than 256 KB", inner);
                else if (entry.read().readUInt32BE(0) !== 0x89504e47) problem("ICON_FILE_INVALID", "An icon is not a PNG file", inner);
                else provides.add("icons");
            }
        } else if (parts[0] === "screenshots") {
            if (parts.length !== 2 || !/\.(png|jpe?g|webp)$/i.test(inner)) problem("SCREENSHOT_INVALID", "Screenshots are png, jpeg or webp files directly under screenshots/", inner);
            else if (entry.size > LIMITS.screenshotBytes) problem("SCREENSHOT_TOO_LARGE", "A screenshot is larger than 5 MB", inner);
        } else if (inner === "icon.png") {
            if (entry.size > LIMITS.iconBytes) problem("ICON_TOO_LARGE", "icon.png is larger than 1 MB", inner);
            else if (entry.read().readUInt32BE(0) !== 0x89504e47) problem("ICON_INVALID", "icon.png is not a PNG file", inner);
        }
    }
    const screenshots = [...files.keys()].filter((f) => f.startsWith("screenshots/")).length;
    if (screenshots > LIMITS.screenshots) problem("SCREENSHOT_TOO_MANY", `At most ${LIMITS.screenshots} screenshots`, "screenshots");
    if (!hasData) problem("DATA_MISSING", "The plugin has no data/ folder", "data");
    return { problems, manifest, provides: [...provides] };
}

function validateManifest(manifest, problem) {
    const path = (field) => `plugin.json#${field}`;
    if (manifest.manifestVersion !== 1) problem("MANIFEST_VERSION_UNSUPPORTED", "manifestVersion must be 1", path("manifestVersion"));
    if (typeof manifest.id !== "string" || !ID_PATTERN.test(manifest.id) || manifest.id.length > 200) problem("ID_INVALID", "id must be a reverse domain of at least three lowercase segments, for example io.github.login.plugin", path("id"));
    if (typeof manifest.version !== "string" || !SEMVER_PATTERN.test(manifest.version)) problem("VERSION_INVALID", "version must be semver", path("version"));
    if (typeof manifest.engine !== "string" || !RANGE_PATTERN.test(manifest.engine.trim())) problem("ENGINE_RANGE_INVALID", "engine must be a semver range such as ^0.1.0", path("engine"));
    if (!Array.isArray(manifest.parts) || manifest.parts.length !== 1 || manifest.parts[0] !== "data") problem("PARTS_UNSUPPORTED", 'parts must be ["data"]', path("parts"));
    if (typeof manifest.name !== "string" || !manifest.name.trim() || manifest.name.length > LIMITS.nameLength) problem("NAME_REQUIRED", `name is required, at most ${LIMITS.nameLength} characters`, path("name"));
    if (typeof manifest.description !== "string" || !manifest.description.trim() || manifest.description.length > LIMITS.descriptionLength) problem("DESCRIPTION_REQUIRED", `description is required, at most ${LIMITS.descriptionLength} characters`, path("description"));
    if (typeof manifest.license !== "string" || !manifest.license.trim()) problem("LICENSE_REQUIRED", "license is required (an SPDX identifier such as MIT)", path("license"));
    if (manifest.authors !== undefined && (!Array.isArray(manifest.authors) || !manifest.authors.every((a) => typeof a === "string"))) problem("AUTHORS_INVALID", "authors must be an array of strings", path("authors"));
    if (manifest.tags !== undefined && (!Array.isArray(manifest.tags) || manifest.tags.length > 10 || !manifest.tags.every((t) => typeof t === "string" && /^[a-z0-9-]{1,32}$/.test(t)))) problem("TAGS_INVALID", "tags are at most ten lowercase words", path("tags"));
    if (manifest.category !== undefined && (typeof manifest.category !== "string" || !/^[a-z0-9-]{1,32}$/.test(manifest.category))) problem("CATEGORY_INVALID", "category is one lowercase word", path("category"));
    if (manifest.links !== undefined) {
        if (typeof manifest.links !== "object" || manifest.links === null || Array.isArray(manifest.links)) problem("LINKS_INVALID", "links must be an object", path("links"));
        else for (const [key, value] of Object.entries(manifest.links)) {
            if (!["repository", "homepage", "issues"].includes(key) || typeof value !== "string" || !/^https:\/\//.test(value)) problem("LINKS_INVALID", `links.${key} must be an https address; allowed keys are repository, homepage, issues`, path(`links.${key}`));
        }
    }
    if (manifest.unlisted !== undefined && typeof manifest.unlisted !== "boolean") problem("UNLISTED_INVALID", "unlisted must be a boolean", path("unlisted"));
}

function validateTheme(entry, inner, problem) {
    let theme;
    try { theme = JSON.parse(entry.read().toString("utf8")); } catch { problem("THEME_FILE_INVALID", "Theme is not valid JSON", inner); return; }
    if (typeof theme !== "object" || theme === null || Array.isArray(theme)) { problem("THEME_FILE_INVALID", "Theme must be an object", inner); return; }
    if (typeof theme.name !== "string" || !theme.name.trim()) problem("THEME_NAME_REQUIRED", "Theme name is required", inner);
    if (!THEME_BASES.has(theme.base)) problem("THEME_BASE_INVALID", 'Theme base must be "dark" or "light"', inner);
    if (typeof theme.colors !== "object" || theme.colors === null || Array.isArray(theme.colors)) { problem("THEME_COLORS_INVALID", "Theme colors must be an object", inner); return; }
    for (const [key, value] of Object.entries(theme.colors)) {
        if (!THEME_COLORS.has(key)) problem("THEME_COLOR_UNKNOWN", `Unknown theme color "${key}"`, `${inner}#colors.${key}`);
        else if (typeof value !== "string" || !HEX_COLOR.test(value)) problem("THEME_COLOR_INVALID", `Color "${key}" must be a hex color`, `${inner}#colors.${key}`);
    }
}

export function validateArchive(buffer) {
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    try {
        const entries = readZip(buffer);
        const result = validateEntries(entries);
        return { valid: result.problems.length === 0, ...result, archiveSize: buffer.length, sha256 };
    } catch (error) {
        if (error instanceof ValidationError) {
            return { valid: false, manifest: null, provides: [], problems: [{ code: error.code, message: error.message, path: error.path }], archiveSize: buffer.length, sha256 };
        }
        throw error;
    }
}

// ---------- command line ----------

function main(argv) {
    const args = argv.slice(2);
    if (args.length === 0 || args.includes("--help")) {
        console.log("Usage: node validate-plugin.mjs <plugin.zip | plugin-folder> [--zip out.zip] [--json]");
        return 0;
    }
    const target = args[0];
    const zipIndex = args.indexOf("--zip");
    const asJson = args.includes("--json");
    if (!existsSync(target)) { console.error(`Not found: ${target}`); return 1; }
    let buffer;
    if (statSync(target).isDirectory()) {
        const packed = packFolder(target);
        if (packed.bad) {
            console.error(`${packed.bad.symlink ? "SYMLINK" : "EXECUTABLE"}: ${packed.bad.name}`);
            return 1;
        }
        if (packed.leftOut.length > 0 && !asJson) console.error(`Left out of the archive: ${packed.leftOut.join(", ")}`);
        buffer = packed.buffer;
        if (zipIndex >= 0 && args[zipIndex + 1]) writeFileSync(args[zipIndex + 1], buffer);
    } else {
        buffer = readFileSync(target);
    }
    const report = validateArchive(buffer);
    if (asJson) {
        console.log(JSON.stringify(report, null, 2));
    } else if (report.valid) {
        console.log(`OK ${report.manifest.id}@${report.manifest.version} provides [${report.provides.join(", ")}] ${report.archiveSize} bytes sha256 ${report.sha256}`);
    } else {
        for (const p of report.problems) console.error(`${p.code}${p.path ? ` (${p.path})` : ""}: ${p.message}`);
    }
    return report.valid ? 0 : 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    process.exit(main(process.argv));
}
