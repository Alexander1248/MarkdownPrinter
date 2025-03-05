import htmlDocx from "html-docx-js";

let conf;
const exports = {};
exports.init = (config) => {
    conf = config['docx'];
}

exports.render = (html) => {
    return htmlDocx.asBlob(html, conf);
}
export default exports;