import args from "args";
import fs from "fs";
import fsp from "fs/promises";
import YAML from "yaml";
import fetch from "node-fetch"; // асинхронный fetch
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

import { MarkdownRenderer } from "./md.js";
import * as docx from "./docx.js";
import * as pdf from "./pdf.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ------------------------
// Parse CLI arguments
// ------------------------
args
    .option("input", "Input file", "(?<name>.*)\\.md")
    .option("output", "Output file", "{{name}}")
    .option("config", "Config document");

const cliData = args.parse(process.argv);

// ------------------------
// Load config
// ------------------------
let config = {};
if (cliData.config) {
    const configContent = await fsp.readFile(cliData.config, "utf-8");
    config = YAML.parse(configContent);
}

log("CONFIG", config);

config.style = "";

if (config.styles) {
    config.style += `<style>\n`;
    for (const url of config.styles) {
        let data;
        if (fs.existsSync(url)) {
            data = (await fsp.readFile(url, "utf-8")).substring(1);
        } else {
            const res = await fetch(url);
            data = await res.text();
        }
        config.style += `${data}\n`;
        // config.style += `<link rel="stylesheet" href="${url}">\n`
    }
    config.style += `</style>`;
}

// ------------------------
// Init render engines
// ------------------------
const printConfig = config.print ?? { html: false, docx: false, pdf: true };
const md = new MarkdownRenderer();
await md.init(config, error);

if (printConfig.docx) await docx.init(config);
if (printConfig.pdf) await pdf.init(config);

// ------------------------
// Render documents
// ------------------------
async function processDirectory(dirPath) {
    const files = await fsp.readdir(dirPath);

    for (const fileIn of files) {
        const match = fileIn.match(cliData.input);
        if (!match) continue;

        let fileOut = cliData.output;
        if (match.groups) {
            for (const key in match.groups) {
                fileOut = fileOut.replace(`{{${key}}}`, match.groups[key]);
            }
        }

        await markdownToFiles(resolve(dirPath, fileIn), fileOut, config.style);
    }
}

await processDirectory(__dirname);

// ------------------------
// Markdown -> Files
// ------------------------
async function markdownToFiles(fileIn, fileOut, style) {
    try {
        const rawData = await fsp.readFile(fileIn, "utf-8");
        let html = await md.render(rawData.toString());
        html = applyReplacements(html, config.replacements);

        html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${fileIn}</title>
${style}
</head>
<body>
<script>window.wait = 0</script>
${md.inject()}
${html}
</body>
</html>`;

        if (printConfig.html) {
            await fsp.writeFile(`${fileOut}.html`, html);
            log("RENDER_HTML", `Render ${fileIn} to ${fileOut}.html`);
        }

        if (printConfig.docx) {
            const blob = await docx.render(html).arrayBuffer();
            const injected = await docx.inject(blob);
            await fsp.writeFile(`${fileOut}.docx`, Buffer.from(injected));
            log("RENDER_DOCX", `Render ${fileIn} to ${fileOut}.docx`);
        }

        if (printConfig.pdf) {
            const blob = await pdf.render(html);
            const injected = await pdf.inject(blob);
            await fsp.writeFile(`${fileOut}.pdf`, injected);
            log("RENDER_PDF", `Render ${fileIn} to ${fileOut}.pdf`);
        }
    } catch (err) {
        error("LOAD", err);
    }
}

// ------------------------
// Apply replacements
// ------------------------
function applyReplacements(html, replacements = []) {
    for (const replacement of replacements) {
        if (!replacement.regex) continue;

        const regex = new RegExp(replacement.regex, "g");

        if (replacement.string) {
            html = html.replaceAll(regex, replacement.string);
        } else if (replacement.code) {
            html = html.replaceAll(regex, eval(replacement.code));
        }
    }
    return html;
}

// ------------------------
// Logging helpers
// ------------------------
function log(type, message) {
    console.log(`[${type}]`, message);
}

function error(type, message) {
    console.error(`[${type}]`, message);
}
