#!/usr/bin/env node
// Checks the plugin folder, packs it and publishes the archive to the registry with the publish
// token of PANDA_PUBLISH_TOKEN (a token from Account → Tokens on pandaengine.dev; keep it out of
// git). The portal checks the archive again and refuses a version that exists. Node 20 or newer.
//
//   PANDA_PUBLISH_TOKEN=pnd_… node tools/publish.mjs .            publish
//   node tools/publish.mjs . --dry-run                             check and pack only
//   node tools/publish.mjs . --registry https://pandaengine.dev    another registry
import { writeFileSync } from "node:fs";
import { packFolder, validateArchive } from "./validate-plugin.mjs";

async function main(argv) {
    const args = argv.slice(2);
    if (args.includes("--help")) {
        console.log("Usage: PANDA_PUBLISH_TOKEN=pnd_… node tools/publish.mjs [plugin-folder] [--dry-run] [--registry <url>]");
        return 0;
    }
    const folder = args.find((arg) => !arg.startsWith("--") && args[args.indexOf(arg) - 1] !== "--registry") ?? ".";
    const dryRun = args.includes("--dry-run");
    const registryIndex = args.indexOf("--registry");
    const registry = (registryIndex >= 0 && args[registryIndex + 1]) ? args[registryIndex + 1].replace(/\/+$/, "") : "https://pandaengine.dev";

    const packed = packFolder(folder);
    if (packed.bad) {
        console.error(`${packed.bad.symlink ? "SYMLINK" : "EXECUTABLE"}: ${packed.bad.name}`);
        return 1;
    }
    if (packed.leftOut.length > 0) console.error(`Left out of the archive: ${packed.leftOut.join(", ")}`);
    const report = validateArchive(packed.buffer);
    if (!report.valid) {
        for (const problem of report.problems) console.error(`${problem.code}${problem.path ? ` (${problem.path})` : ""}: ${problem.message}`);
        return 1;
    }
    const { id, version } = report.manifest;
    const fileName = `${id}-${version}.zip`;
    writeFileSync("plugin.zip", packed.buffer);
    console.log(`OK ${id}@${version} provides [${report.provides.join(", ")}] ${report.archiveSize} bytes → plugin.zip`);
    if (dryRun) return 0;

    const token = process.env.PANDA_PUBLISH_TOKEN;
    if (!token) {
        console.error("PANDA_PUBLISH_TOKEN is not set: make a publish token under Account → Tokens on pandaengine.dev and export it.");
        return 1;
    }
    const form = new FormData();
    form.append("archive", new Blob([packed.buffer], { type: "application/zip" }), fileName);
    let response;
    try {
        response = await fetch(`${registry}/api/v1/packages`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
    } catch (error) {
        console.error(`The registry did not answer: ${error.message}`);
        return 1;
    }
    const body = await response.json().catch(() => null);
    if (response.ok) {
        console.log(`Published ${id}@${version}: ${registry}/plugins/${id}`);
        return 0;
    }
    console.error(`${response.status} ${body?.code ?? ""}: ${body?.message ?? "the upload was refused"}`);
    for (const detail of body?.details ?? []) console.error(`  ${detail.code}${detail.path ? ` (${detail.path})` : ""}: ${detail.message}`);
    const hints = {
        VERSION_EXISTS: "Versions are immutable: raise version in plugin.json and add a CHANGELOG entry.",
        NAMESPACE_FORBIDDEN: "The id must be inside one of your namespaces (io.github.<login>.* after linking GitHub in the profile).",
        UNAUTHORIZED: "The token is invalid or revoked: make a new one under Account → Tokens.",
    };
    if (hints[body?.code]) console.error(hints[body.code]);
    return 1;
}

main(process.argv).then((code) => process.exit(code), (error) => {
    console.error(error.message);
    process.exit(1);
});
