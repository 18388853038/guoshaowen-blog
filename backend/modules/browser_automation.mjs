#!/usr/bin/env node
// @ts-check
/**
 * Browser Automation Bridge - 由 CEO_TOOLS browser_automation handler 调用
 * 使用 Playwright 提供浏览器自动化能力
 * 参数从第一个参数指定的 JSON 文件读取
 */
import playwright from 'playwright';
import fs from 'fs';

const argsFile = process.argv[2];
if (!argsFile) {
  console.log(JSON.stringify({ success: false, error: 'missing args file' }));
  process.exit(1);
}

const args = JSON.parse(fs.readFileSync(argsFile, 'utf8'));

async function main() {
  let browser = null;
  try {
    browser = await playwright.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      locale: 'zh-CN'
    });
    const page = await context.newPage();

    let result = { success: true };

    switch (args.action) {
      case 'navigate': {
        if (!args.url) throw new Error('url required');
        const waitUntil = args.waitUntil || 'load';
        const timeout = args.timeout || 15000;
        await page.goto(args.url, { waitUntil, timeout });
        const title = await page.title();
        result = { success: true, title, url: page.url(), message: '页面加载完成: ' + title };
        break;
      }

      case 'screenshot': {
        if (!args.url) throw new Error('url required');
        const waitUntil = args.waitUntil || 'networkidle';
        const timeout = args.timeout || 15000;
        await page.goto(args.url, { waitUntil, timeout });
        const outputPath = args.outputPath || fs.mkdtempSync('browser_') + '.png';
        await page.screenshot({ path: outputPath, fullPage: true });
        result = { success: true, path: outputPath, message: '截图已保存: ' + outputPath };
        break;
      }

      case 'get_content': {
        if (!args.url) throw new Error('url required');
        const waitUntil = args.waitUntil || 'load';
        const timeout = args.timeout || 15000;
        await page.goto(args.url, { waitUntil, timeout });
        const content = await page.evaluate(() => {
          // 获取主要文本内容
          const main = document.querySelector('main') || document.querySelector('article') || document.body;
          const text = main.innerText || main.textContent || '';
          return text.substring(0, 10000);
        });
        const title = await page.title();
        const url = page.url();
        result = { success: true, title, url, content: content.substring(0, 10000), message: '页面内容获取完成: ' + title };
        break;
      }

      case 'click': {
        if (!args.selector) throw new Error('selector required');
        if (args.url) await page.goto(args.url, { waitUntil: args.waitUntil || 'load', timeout: args.timeout || 15000 });
        await page.waitForSelector(args.selector, { timeout: args.timeout || 10000 });
        await page.click(args.selector);
        await page.waitForTimeout(1000);
        const title = await page.title();
        result = { success: true, title, url: page.url(), message: '点击成功: ' + args.selector };
        break;
      }

      case 'fill': {
        if (!args.selector) throw new Error('selector required');
        if (!args.value) throw new Error('value required');
        if (args.url) await page.goto(args.url, { waitUntil: args.waitUntil || 'load', timeout: args.timeout || 15000 });
        await page.waitForSelector(args.selector, { timeout: args.timeout || 10000 });
        await page.fill(args.selector, args.value);
        result = { success: true, message: '填写完成: ' + args.selector + ' = ' + args.value.substring(0, 50) };
        break;
      }

      case 'evaluate': {
        if (!args.script) throw new Error('script required');
        const evalResult = await page.evaluate(args.script);
        result = { success: true, data: evalResult, message: 'JS执行完成' };
        break;
      }

      case 'get_title': {
        if (args.url) await page.goto(args.url, { waitUntil: args.waitUntil || 'load', timeout: args.timeout || 15000 });
        const title = await page.title();
        const url = page.url();
        result = { success: true, title, url, message: '页面标题: ' + title };
        break;
      }

      case 'pdf': {
        if (!args.url) throw new Error('url required');
        await page.goto(args.url, { waitUntil: 'networkidle', timeout: args.timeout || 30000 });
        const outputPath = args.outputPath || fs.mkdtempSync('browser_pdf_') + '.pdf';
        await page.pdf({ path: outputPath, format: 'A4' });
        result = { success: true, path: outputPath, message: 'PDF已保存: ' + outputPath };
        break;
      }

      default:
        throw new Error('unknown action: ' + args.action);
    }

    console.log(JSON.stringify(result));
  } catch (e) {
    console.log(JSON.stringify({ success: false, error: e.message }));
  } finally {
    if (browser) await browser.close();
    // cleanup temp file
    if (argsFile) try { fs.unlinkSync(argsFile); } catch(e) {}
  }
}

main();
