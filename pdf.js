import htmlPdf from "html-pdf-node";

let conf;
const exports = {};
exports.init = (config) => {
    conf = config['pdf'];
}

exports.render = async (html) => {
    return await htmlPdf.generatePdf({ content: html }, conf ?? {});
}
export default exports;