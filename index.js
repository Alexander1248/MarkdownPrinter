import args from "args";
import fs from "fs";
import fsp from "fs/promises";
import YAML from "yaml";
import fetch from "node-fetch"; // асинхронный fetch
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import slugify from "@sindresorhus/slugify";

import { MarkdownRenderer } from "./md.js";
import * as docx from "./docx.js";
import * as base_pdf from "./render.js";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import zlib from "zlib";
import Prince from "prince";
import * as util from "node:util";
import crypto from "node:crypto";
// ------------------------
// Parse CLI arguments
// ------------------------
args
    .option("path", "Search path", ".")
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
const printConfig = config.print ?? { html: false, docx: false, base_pdf: true, prince_pdf: false };
const md = new MarkdownRenderer();

const sharedContext = {
    zlib,
    yaml: YAML,
    fetch,
    md,
    log: (s) => log("REPLACEMENT", s),
    error: (s) => error("REPLACEMENT", s),
    slugify,
    store: {}
};


// process.stdin.resume(); // so the program will not close instantly
// async function exitHandler(options, exitCode) {
//     if (printConfig.base_pdf) await base_pdf.complete();
//     if (exitCode || exitCode === 0) console.log(exitCode);
//     process.exit();
// }
// // do something when app is closing
// process.on('exit', exitHandler.bind(null,{}));
// // catches ctrl+c event
// process.on('SIGINT', exitHandler.bind(null, {}));
// // catches "kill pid" (for example: nodemon restart)
// process.on('SIGUSR1', exitHandler.bind(null, {}));
// process.on('SIGUSR2', exitHandler.bind(null, {}));
// // catches uncaught exceptions
// process.on('uncaughtException', exitHandler.bind(null, {}));


await md.init(config, sharedContext, error);
if (printConfig.docx) await docx.init(config);
if (printConfig.base_pdf) await base_pdf.init(config);
await processDirectory(path.resolve(__dirname, cliData.path || '.'));

// ------------------------
// Render documents
// ------------------------
async function processDirectory(dirPath) {
    const files = await fsp.readdir(dirPath, {recursive: config.recursive || false});
    let tasks = 0;
    let limiterStrike = false;
    for (const fileIn of files) {
        const match = fileIn.match(cliData.input);
        if (!match) continue;
        let fileOut = path.resolve(dirPath, cliData.output);
        if (match.groups) {
            for (const key in match.groups) {
                fileOut = fileOut.replace(`{{${key}}}`, match.groups[key]);
            }
        }
        const filename = resolve(dirPath, fileIn);
        while (config.task_limiter  && tasks >= config.task_limiter) {
            await sleep(1000)
            if (limiterStrike) continue;
            limiterStrike = true;
            log("LIMITER", "Task rate limited! Waiting for free resources!")
        }
        limiterStrike = false;
        tasks++
        markdownToFiles(filename, fileOut, dirPath, config.style).then(r => {
            tasks--
            log("PROCESSOR", `File ${filename} converted!`)
        });
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function hash(str) {
    return crypto.createHash("sha256").update(str).digest("hex");
}

// ------------------------
// Markdown -> Files
// ------------------------
async function markdownToFiles(fileIn, fileOut, rootDir, style) {
    try {
        const rawData = await fsp.readFile(fileIn, "utf-8");
        let html = await md.render(rawData.toString());
        html = applyReplacements(html, config.replacements, sharedContext);

        html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${fileIn}</title>
${style}
<script>window.wait = 0</script>
${md.inject()}
</head>
<body>
${html}
</body>
</html>`;

        if (printConfig.html) {
            log("HTML", `Render ${fileIn} to ${fileOut}.html`);
            await fsp.writeFile(`${fileOut}.html`, html);
        }
        if (printConfig.docx) {
            log("DOCX", `Render ${fileIn} to ${fileOut}.docx`);
            const blob = await docx.render(html).arrayBuffer();
            const injected = await docx.inject(blob);
            await fsp.writeFile(`${fileOut}.docx`, Buffer.from(injected));
        }

        if (printConfig.base_pdf) {
            let name = `${fileOut}${printConfig.prince_pdf ? "_base" : ""}.pdf`
            log("BASE_PDF", `Render ${fileIn} to ${name}`);
            const blob = await base_pdf.renderPdf(html);
            const injected = await base_pdf.inject(blob, fileIn, rootDir);
            await fsp.writeFile(name, injected);
        }

        if (printConfig.prince_pdf) {
            let name = `${fileOut}${printConfig.base_pdf ? "_prince" : ""}.pdf`
            log("PRINCE_PDF", `Render ${fileIn} to ${name}`)
            let prince_config = config.prince_pdf ?? {};
            const renderedHtml = await base_pdf.renderHtml(html);
            const temp = `${fileOut}_prince.html`;
            await fsp.writeFile(temp, renderedHtml);
            await new Prince()
                .cwd(rootDir)
                .timeout(prince_config.timeout)
                .inputs(temp)
                .output(name)
                .option("javascript", true)
                .execute()
            await fsp.unlink(temp)
            const blob = await fsp.readFile(name);
            const injected = await base_pdf.inject(blob, fileIn, rootDir);
            await fsp.writeFile(name, injected);
        }
    } catch (err) {
        error("LOAD", util.inspect(err));
    }
}

// ------------------------
// Apply replacements
// ------------------------
function applyReplacements(html, replacements = [], context = {}) {
    for (const replacement of replacements) {
        if (!replacement.regex) continue;

        const regex = new RegExp(replacement.regex, "g");

        if (replacement.string) {
            html = html.replaceAll(regex, replacement.string);
        }
        else if (replacement.code) {
            const fn = eval(`(${replacement.code})`);
            html = html.replaceAll(regex, (...args) =>
                fn(context, ...args)
            );
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