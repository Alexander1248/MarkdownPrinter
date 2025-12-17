import puppeteer from "puppeteer";
import Promise from "bluebird";
import hb from "handlebars";
import crypto from "node:crypto";
// import inlineCss from "inline-css"; // если нужно

function hash(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}
let cache = {};
let browser;
export async function init(options) {
  let args = ["--no-sandbox", "--disable-setuid-sandbox"];
  if (options.args) {
    args = options.args;
    delete options.args;
  }
  browser = await puppeteer.launch({
    args,
    headless: options.puppeteer?.headless ?? true,
  });
}

async function run(file, options) {
  if (file.content) {
    let h = hash(file.content);
    if (cache[h]) return cache[h];

    const page = await browser.newPage();
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
    cache[h] = page;
    return page;
  } else {
    let h = hash(file.url);
    if (cache[h]) return cache[h];

    const page = await browser.newPage();
    await page.goto(file.url, {
      waitUntil: ["load", "networkidle0"],
    });
    cache[h] = page;
    return page;
  }
}
/**
 * Генерация одного PDF
 * @param {Object} file { content?: string, url?: string }
 * @param {Object} options опции Puppeteer
 * @param {Function} [callback] колбэк
 * @returns {Promise<Buffer>}
 */
export async function generatePdf(file, options, callback) {
  const page = await run(file, options);
  return Promise.props(page.pdf(options))
      .then(async function (data) {
        return Buffer.from(Object.values(data));
      })
      .asCallback(callback);
}

/**
 * Генерация одного
 * @param {Object} file { content?: string, url?: string }
 * @param {Object} options опции Puppeteer
 * @returns {Promise<string>}
 */
export async function generateHtml(file, options) {
  const page = await run(file, options);
  return page.evaluate(() => {
    document.querySelectorAll("script").forEach(s => s.remove());
    return document.documentElement.outerHTML;
  })
}

export async function close() {
  await browser.close();
}
