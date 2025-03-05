import args from "args";
import fs from "fs";
import fsp from "fs/promises";
import YAML from "yaml";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import md from "./md.js";
import docx from "./docx.js";
import pdf from "./pdf.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

args
    .option('input', 'Input file', "(?<name>.*)\.md")
    .option('output', 'Output file', "{{name}}")
    .option('config', 'Config document')

const data = args.parse(process.argv)

// Load config
let config;
if ("config" in data)
    config = YAML.parse(fs.readFileSync(data.config, "utf-8"));
else config = {};
log("CONFIG", config)
config.style = fs.readFileSync(config.style, "utf-8").substring(1);

// Init render engines
const print = config.print ?? { html: false, docx: false, pdf: true };
await md.init(config);
if (print.docx == true) docx.init(config);
if (print.pdf == true) pdf.init(config);

// Render documents

fsp.readdir(__dirname).then(files => {
    files.forEach(fileIn => {
        let match = fileIn.match(data.input);
        if (!match) return;
        let fileOut = data.output;
        for (let key in match.groups)
            fileOut = fileOut.replace(`{{${key}}}`, match.groups[key]);
        markdownToFiles(fileIn, fileOut, config.style);
    })
}).catch(err => error("DIR", err));


function markdownToFiles(fileIn, fileOut, style) {
    fsp.readFile(fileIn, "utf-8").then(async data => {
        let html = md.render(data.toString())
        html = applyReplacements(html);
        html = `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>${fileIn}</title>
        </head>
        <body>
            ${md.inject()}
            <style>${style}</style>
            ${html}
        </body>
        </html>`;
        if (print.html == true) {
            fsp.writeFile(`${fileOut}.html`, html)
                .catch(err => error("SAVE_HTML", err));
            log("RENDER_HTML", `Render ${fileIn} to ${fileOut}.html`);
        }
        if (print.docx == true) {
            const blob = await docx.render(html).arrayBuffer();
            fsp.writeFile(`${fileOut}.docx`, Buffer.from(blob))
                .catch(err => error("SAVE_DOCX", err));
            log("RENDER_DOCX", `Render ${fileIn} to ${fileOut}.docx`);
        }

        if (print.pdf == true) {
            const blob = await pdf.render(html);
            fsp.writeFile(`${fileOut}.pdf`, blob)
                .catch(err => error("SAVE_PDF", err));
            log("RENDER_PDF", `Render ${fileIn} to ${fileOut}.pdf`);
        }
    }).catch(err => error("LOAD", err));
}

function applyReplacements(html) {
    for (let index in config.replacements) {
        const replacement = config.replacements[index];
        if (!replacement.regex) continue;
        const regex = RegExp(replacement.regex, "g");
        if (replacement.string)
            html = html.replaceAll(regex, replacement.string);
        else if (replacement.code)
            html = html.replaceAll(regex, eval(replacement.code));

    }
    return html;
}

function log(type, message) {
    console.log(`[${type}] `, message);
}
function error(type, message) {
    console.error(`[${type}] `, message);
}