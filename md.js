import markdownIt from "markdown-it";
import fs from "fs";
import fetch from "sync-fetch";
import requireFromUrl from "require-from-web";

const regex = /<img(?<before>.*)src="(?<url>(?!data:image\/.+;base64,).+?)"(?<after>.*?)>/g;

const exports = {};
let md = markdownIt()
let loader = "";
exports.init = async (config) => {
    let conf = config.markdown;
    if (conf.settings)
        md = markdownIt(conf.settings);
    if (conf.modules) {
        for (let key in conf.modules) {
            let module = conf.modules[key];
            if (module.url) md.use(await requireFromUrl(module.url), module.settings)
            if (module.loader) loader += module.loader + "\n";
        }
    }
}

exports.inject = () => loader;

exports.render = (text) => {
    return md.render(text).replaceAll(regex, replaceToBase64Images);
}

function replaceToBase64Images(match, before, url, after){
    let format = url.substring(url.lastIndexOf('.') + 1, url.length);
    if (format === 'jpg') format = 'jpeg';
    let data;
    if (fs.existsSync(url))
        data = fs.readFileSync(url,'latin1');
    else data = Buffer.from(fetch(url).arrayBuffer()).toString('latin1');
    return `<img${before}src="data:image/${format};base64,${btoa(data)}"${after}/>`;
}

export default exports;