import * as htmlPdf from "./html-to-pdf.js";
import { PDFDocument } from "pdf-lib";
import fsp from "fs/promises";
import * as path from 'path';

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
 * @param {String} filepath Путь до файла
 * @param {String} baseDir Путь до корня проекта
 * @returns {Promise<Buffer>} Новый PDF с инъекцией
 */
export async function inject(buffer, filepath, baseDir) {
    const doc = await PDFDocument.load(buffer);

    let pages = config?.pages ?? {};
    if (pages && Object.keys(pages).length !== 0) {
        for (const key of Object.keys(pages)) {
            const entry = pages[key];
            if (!entry?.pdf) continue;
            if (!entry?.file || path.resolve(baseDir, filepath) !== path.resolve(baseDir, entry.file)) continue;

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
    }

    let env = config?.env ?? {};
    if (env) {

    }

    return Buffer.from(await doc.save());
}