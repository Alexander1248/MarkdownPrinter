import htmlPdf from "html-to-pdf.js";

let config = {};

/**
 * Инициализация модуля PDF
 * @param {Object} cfg Конфигурация из main config.pdf
 */
export function init(cfg) {
    config = cfg ?? {};
}

/**
 * Рендер HTML в PDF
 * @param {string} html HTML-контент
 * @returns {Promise<Buffer>} Буфер PDF
 */
export async function render(html) {
    return await htmlPdf.generatePdf({ content: html }, config);
}