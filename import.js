import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch";
import { pathToFileURL } from "node:url";

/* ============================
   Utils
============================ */

function hash(str) {
    return crypto.createHash("sha256").update(str).digest("hex");
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/* ============================
   Import parser (ESM)
============================ */

const IMPORT_RE =
    /(?:import|export)\s+(?:[^'"]*?\s+from\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

/* ============================
   Recursive importer
============================ */

export async function importFromUrlRecursive(
    entryUrl,
    cacheDir = "./.tmp_modules",
    seen = new Map()
) {
    ensureDir(cacheDir);

    if (seen.has(entryUrl)) {
        return seen.get(entryUrl);
    }

    const fileHash = hash(entryUrl);
    const localFile = path.join(cacheDir, `${fileHash}.mjs`);
    seen.set(entryUrl, localFile);

    if (!fs.existsSync(localFile)) {
        const res = await fetch(entryUrl);
        if (!res.ok) {
            throw new Error(`Failed to fetch ${entryUrl}`);
        }

        let code = await res.text();
        let deps = new Set();
        let match;

        while ((match = IMPORT_RE.exec(code))) {
            const raw = match[1] || match[2];
            if (!raw) continue;

            // 🔥 РЕЗОЛВИНГ ПО СПЕКЕ ESM
            try {
                const resolved = resolveImport(raw, entryUrl);
                if (!resolved) continue;
                deps.add({ raw, resolved });
            } catch {
                // например import "node:fs" — пропускаем
            }
        }

        for (const { raw, resolved } of deps) {
            if (
                resolved.startsWith("http://") ||
                resolved.startsWith("https://")
            ) {
                const depLocal = await importFromUrlRecursive(
                    resolved,
                    cacheDir,
                    seen
                );

                const depFileUrl = pathToFileURL(
                    path.resolve(depLocal)
                ).href;

                code = code.split(raw).join(depFileUrl);
            }
        }

        fs.writeFileSync(localFile, code, "utf8");
    }

    return localFile;
}

/* ============================
   Helper: import entry module
============================ */

export default async function importUrl(entryUrl, cacheDir) {
    const localFile = await importFromUrlRecursive(entryUrl, cacheDir);
    return import(pathToFileURL(path.resolve(localFile)).href);
}

function resolveImport(raw, parentUrl) {
    try {
        return new URL(raw, parentUrl).href;
    } catch {}

    // bare import → CDN
    const parent = new URL(parentUrl);

    if (parent.hostname.includes("jsdelivr.net")) {
        return `https://cdn.jsdelivr.net/npm/${raw}`;
    }

    if (parent.hostname.includes("unpkg.com")) {
        return `https://unpkg.com/${raw}`;
    }

    return null;
}
