import markdownIt from "markdown-it";
import fs from "fs";
import path from "node:path";
import fetch from "node-fetch"; // Асинхронный fetch для URL
import requireFromUrl from "require-from-web"
import * as util from "node:util";
import importUrl from "./import.js";

const imgRegex = /<img(?<before>.*)src="(?<url>(?!data:image\/.+;base64,).+?)"(?<after>.*?)\/?>/gm;
const doctypeRegex = /<!DOCTYPE.+?>/g;


export class MarkdownRenderer {
    constructor() {
        this.md = markdownIt();
        this.loader = "";
        this.convertImages = true;
    }

    /**
     * Инициализация с конфигом
     */
    async init(config, sharedContext, errorLogger = console.error) {
        const conf = config.markdown || {};

        if (conf.settings) this.md = markdownIt(conf.settings);

        if (conf.convertImages != null) this.convertImages = conf.convertImages;

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
                                errorLogger("MODULES", util.inspect(err));
                            }
                        }
                        // 2. Если не получилось — ESM
                        if (!plugin)
                            plugin = await importUrl(moduleConfig.path);
                        // if (moduleConfig.import) {
                        //     plugin = plugin.default[moduleConfig.import];
                        // }

                        if (typeof plugin !== "function")
                            plugin = plugin.default;

                        if (typeof plugin !== "function")
                            throw new Error(`Plugin ${key} is not a function`);

                        let settings;
                        if (moduleConfig.settings) settings = moduleConfig.settings;
                        else if (moduleConfig.configurer) settings = eval(moduleConfig.configurer)(sharedContext, moduleConfig);
                        this.md.use(plugin, settings);
                    }
                    if (moduleConfig.loader) {
                        this.loader += moduleConfig.loader + "\n";
                    }
                    if (moduleConfig.rule) {
                        let settings;
                        if (moduleConfig.settings) settings = moduleConfig.settings;
                        else if (moduleConfig.configurer) settings = eval(moduleConfig.configurer)(sharedContext, moduleConfig);
                        this.md.use(eval(moduleConfig.rule), settings);
                    }
                } catch (err) {
                    errorLogger("MODULES", `Module ${key} failed!\n${util.inspect(err)}`);
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
        const html = this.md.render(text, {});
        if (this.convertImages) return await this.replaceImages(html);
        return html;
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
