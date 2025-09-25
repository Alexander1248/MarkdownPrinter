import * as htmlPdf from "./html-to-pdf.js";
import { PDFDocument } from "pdf-lib";
import fsp from "fs/promises";

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

/**
 * Инъекция страниц из config.pages.*.pdf в сгенерированный PDF
 * @param {Buffer|Uint8Array} buffer Исходный PDF
 * @returns {Promise<Buffer>} Новый PDF с инъекцией
 */
export async function inject(buffer) {
    let pages = config?.pages ?? {};
    if (!pages || Object.keys(pages).length === 0) return buffer;

    const doc = await PDFDocument.load(buffer);

    for (const key of Object.keys(pages)) {
        const entry = pages[key];
        if (!entry?.pdf) continue;

        // Загружаем внешний PDF
        const extBytes = await fsp.readFile(entry.pdf);
        const extDoc = await PDFDocument.load(extBytes);

        // Копируем все страницы из внешнего PDF
        const extPages = await doc.copyPages(extDoc, extDoc.getPageIndices());

        // Определяем индекс вставки
        const insertAt = Math.min(
            Math.max(entry.index ?? 0, 0),
            doc.getPageCount()
        );

        // Вставляем страницы
        for (let i = 0; i < extPages.length; i++) {
            doc.insertPage(insertAt + i, extPages[i]);
        }
    }

    const out = await doc.save();
    return Buffer.from(out);
}