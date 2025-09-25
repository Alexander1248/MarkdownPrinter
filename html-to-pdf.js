import puppeteer from "puppeteer";
import Promise from "bluebird";
import hb from "handlebars";
// import inlineCss from "inline-css"; // если нужно

/**
 * Генерация одного PDF
 * @param {Object} file { content?: string, url?: string }
 * @param {Object} options опции Puppeteer
 * @param {Function} [callback] колбэк
 * @returns {Promise<Buffer>}
 */
export async function generatePdf(file, options, callback) {
  let args = ["--no-sandbox", "--disable-setuid-sandbox"];
  if (options.args) {
    args = options.args;
    delete options.args;
  }

  const browser = await puppeteer.launch({
    args,
    headless: options.puppeteer?.headless ?? true,
  });
  const page = await browser.newPage();

  if (file.content) {
    const data = file.content; // await inlineCss(file.content, { url: "/" })
    console.log("Compiling the template with handlebars");

    const template = hb.compile(data, { strict: true });
    const html = template(data);

    await page.setContent(html, {
      waitUntil: "networkidle0",
      timeout: options.puppeteer?.wait_timeout ?? 60000,
    });

    try {
      await page.waitForFunction("window.wait <= 0", {
        timeout: options.puppeteer?.wait_timeout ?? 60000,
      });
    } catch {
      // игнорируем timeout
    }
  } else {
    await page.goto(file.url, {
      waitUntil: ["load", "networkidle0"],
    });
  }

  return Promise.props(page.pdf(options))
      .then(async function (data) {
        await browser.close();
        return Buffer.from(Object.values(data));
      })
      .asCallback(callback);
}

/**
 * Генерация массива PDF
 * @param {Array} files список файлов { content?: string, url?: string }
 * @param {Object} options опции Puppeteer
 * @param {Function} [callback] колбэк
 * @returns {Promise<Array<{ buffer: Buffer }>>}
 */
export async function generatePdfs(files, options, callback) {
  let args = ["--no-sandbox", "--disable-setuid-sandbox"];
  if (options.args) {
    args = options.args;
    delete options.args;
  }

  const browser = await puppeteer.launch({ args });
  const page = await browser.newPage();

  const pdfs = [];
  for (const file of files) {
    if (file.content) {
      const data = file.content;
      console.log("Compiling the template with handlebars");

      const template = hb.compile(data, { strict: true });
      const html = template(data);

      await page.setContent(html, {
        waitUntil: "networkidle0",
      });
    } else {
      await page.goto(file.url, {
        waitUntil: "networkidle0",
      });
    }

    const pdfObj = { ...file };
    delete pdfObj.content;
    pdfObj.buffer = Buffer.from(Object.values(await page.pdf(options)));
    pdfs.push(pdfObj);
  }

  return Promise.resolve(pdfs)
      .then(async function (data) {
        await browser.close();
        return data;
      })
      .asCallback(callback);
}
