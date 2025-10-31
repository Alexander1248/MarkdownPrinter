import markdownIt from "markdown-it";
import fs from "fs";
import path from "node:path";
import crypto from "node:crypto";
import fetch from "node-fetch"; // Асинхронный fetch для URL
import requireFromUrl from "require-from-web"

const imgRegex = /<img(?<before>.*)src="(?<url>(?!data:image\/.+;base64,).+?)"(?<after>.*?)\/?>/gm;
const doctypeRegex = /<!DOCTYPE.+?>/g;

function hashUrl(url) {
    return crypto.createHash("sha256").update(url).digest("hex");
}

/**
 * Импорт модуля с URL с кешированием на диск
 */
async function importFromUrl(url, tempDir = "./.tmp_modules") {
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const fileName = path.join(tempDir, hashUrl(url) + ".mjs");

    if (!fs.existsSync(fileName)) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch ${url}`);
        const code = await res.text();
        fs.writeFileSync(fileName, code, "utf8");
    }

    return await import(`file://${path.resolve(fileName)}`);
}

export class MarkdownRenderer {
    constructor() {
        this.md = markdownIt();
        this.loader = "";
    }

    /**
     * Инициализация с конфигом
     */
    async init(config, errorLogger = console.error) {
        const conf = config.markdown || {};

        if (conf.settings) this.md = markdownIt(conf.settings);


        if (conf.modules) {
            for (let key in conf.modules) {
                try {
                    const moduleConfig = conf.modules[key];

                    if (moduleConfig.path) {
                        let plugin;
                        if (!plugin) {
                            // 1. Попытка загрузить CommonJS через require-from-web
                            try {
                                plugin = await requireFromUrl(moduleConfig.path);
                            } catch(err) {
                                errorLogger("MODULES", err);
                            }
                        }
                        // 2. Если не получилось — ESM
                        if (!plugin) {
                            const mod = await importFromUrl(moduleConfig.path);
                            plugin = mod.default || mod;
                        }

                        if (typeof plugin !== "function")
                            throw new Error(`Plugin ${key} is not a function`);

                        this.md.use(plugin, moduleConfig.settings);
                    }

                    if (moduleConfig.loader) {
                        this.loader += moduleConfig.loader + "\n";
                    }
                } catch (e) {
                    errorLogger("MODULES", `Module ${key} failed!\n${e}`);
                }
            }
        }
    }

    /**
     * Получить скрипты loader
     */
    inject() {
        return this.loader;
    }

    /**
     * Рендер Markdown с конвертацией <img> в base64
     */
    async render(text) {
        const html = this.md.render(text);
        return await this.replaceImages(html);
    }

    /**
     * Асинхронная замена <img src="...">
     */
    async replaceImages(html) {
        const promises = [];
        const replacements = [];

        html.replaceAll(imgRegex, (match, before, url, after) => {
            const p = this.convertToBase64(url).then(base64 => {
                replacements.push({ match, replacement: `<img${before}src="${base64}"${after}/>` });
            });
            promises.push(p);
            return match;
        });

        await Promise.all(promises);

        let result = html;
        for (const r of replacements) result = result.replace(r.match, r.replacement);
        return result;
    }

    /**
     * Конвертация изображения (файл или URL) в base64
     */
    async convertToBase64(url) {
        let data, format;

        if (fs.existsSync(url)) {
            format = path.extname(url).substring(1);
            if (format === "jpg") format = "jpeg";
            data = fs.readFileSync(url);
        } else {
            const response = await fetch(url);
            const type = response.headers.get("content-type");
            if (!type.startsWith("image")) return "";
            format = type.split("/")[1];
            if (format === "svg+xml") {
                const text = await response.text();
                return text.replaceAll(doctypeRegex, "");
            }
            data = Buffer.from(await response.arrayBuffer());
        }

        return `data:image/${format};base64,${data.toString("base64")}`;
    }
}
