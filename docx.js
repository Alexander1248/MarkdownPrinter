import htmlDocx from "html-docx-js";

let config = {};

/**
 * Инициализация модуля DOCX
 * @param {Object} cfg Конфигурация из main config.docx
 */
export function init(cfg) {
    config = cfg ?? {};
}

/**
 * Рендер HTML в DOCX
 * @param {string} html HTML-контент
 * @returns {Blob} Blob DOCX
 */
export function render(html) {
    return htmlDocx.asBlob(html, config);
}
