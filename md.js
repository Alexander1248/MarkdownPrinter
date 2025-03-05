import markdownIt from "markdown-it";
import fs from "fs";
import fetch from "sync-fetch";
import requireFromUrl from "require-from-web";

const imgRegex = /<img(?<before>.*)src="(?<url>(?!data:image\/.+;base64,).+?)"(?<after>.*?)\/>/g;
const doctypeRegex = /<!DOCTYPE.+?>/g


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
    return md.render(text).replaceAll(imgRegex, replaceToBase64Images);
}

function replaceToBase64Images(match, before, url, after){
    let data, format;
    if (fs.existsSync(url)) {
        format = url.substring(url.lastIndexOf('.') + 1, url.length);
        if (format === 'jpg') format = 'jpeg';
        data = fs.readFileSync(url, 'latin1');
    }
    else {
        let response = fetch(url);
        let type = response.headers.get('content-type');
        if (!type.startsWith('image')) return '';
        type = type.substring(6);
        format = type;
        if (type === 'svg+xml')
            return response.text().replaceAll(doctypeRegex, '');
        data = Buffer.from(response.arrayBuffer()).toString('latin1');
    }
    return `<img${before}src="data:image/${format};base64,${btoa(data)}"${after}/>`;
}

export default exports;