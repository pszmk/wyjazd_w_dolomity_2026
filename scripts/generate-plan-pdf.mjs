#!/usr/bin/env node
/**
 * Generate a PDF from a version PLAN.md file.
 * Run: node scripts/generate-plan-pdf.mjs version-a/PLAN.md
 */
import { chromium } from 'playwright';
import { marked } from 'marked';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function preprocessMarkdown(md, baseDir) {
  const mermaidBlocks = [];
  let processed = md.replace(/```mermaid\n([\s\S]*?)```/g, (_, code) => {
    const id = mermaidBlocks.length;
    mermaidBlocks.push(code.trim());
    return `<div class="mermaid" data-index="${id}">MERMAID_PLACEHOLDER_${id}</div>`;
  });

  processed = processed.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_, alt, src) => {
      if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
        return `![${alt}](${src})`;
      }
      const abs = path.resolve(baseDir, src);
      const fileUrl = `file://${abs}`;
      return `![${alt}](${fileUrl})`;
    },
  );

  return { processed, mermaidBlocks };
}

function buildHtml(title, bodyHtml, mermaidBlocks) {
  let html = bodyHtml;
  for (let i = 0; i < mermaidBlocks.length; i++) {
    html = html.replace(
      `<div class="mermaid" data-index="${i}">MERMAID_PLACEHOLDER_${i}</div>`,
      `<div class="mermaid">${escapeHtml(mermaidBlocks[i])}</div>`,
    );
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      font-size: 10.5pt;
      line-height: 1.45;
      color: #1a1a1a;
      max-width: 100%;
      margin: 0;
      padding: 0;
    }
    h1 {
      font-size: 20pt;
      margin: 0 0 0.6em;
      padding-bottom: 0.25em;
      border-bottom: 2px solid #2d6a4f;
      color: #1b4332;
      page-break-after: avoid;
    }
    h2 {
      font-size: 14pt;
      margin: 1.4em 0 0.5em;
      color: #1b4332;
      page-break-after: avoid;
      break-before: page;
    }
    h2:first-of-type { break-before: auto; }
    h3 {
      font-size: 11.5pt;
      margin: 1em 0 0.4em;
      color: #2d6a4f;
      page-break-after: avoid;
    }
    p, li { orphans: 3; widows: 3; }
    a { color: #1d6a96; text-decoration: none; }
    a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 8pt; color: #666; word-break: break-all; }
    hr { border: none; border-top: 1px solid #ccc; margin: 1.2em 0; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 0.8em 0 1em;
      font-size: 9.5pt;
      page-break-inside: avoid;
    }
    th, td {
      border: 1px solid #bbb;
      padding: 5px 7px;
      text-align: left;
      vertical-align: top;
    }
    th { background: #e8f3ec; font-weight: 600; }
    tr:nth-child(even) td { background: #f8faf9; }
    pre, code {
      font-family: "Consolas", "Menlo", monospace;
      font-size: 8.5pt;
    }
    pre {
      background: #f4f6f5;
      border: 1px solid #d8deda;
      border-radius: 4px;
      padding: 0.7em 0.9em;
      overflow-x: auto;
      white-space: pre-wrap;
      page-break-inside: avoid;
    }
    code { background: #f0f3f1; padding: 0.1em 0.25em; border-radius: 3px; }
    pre code { background: none; padding: 0; }
    img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 0.8em auto;
      border: 1px solid #ccc;
      border-radius: 4px;
      page-break-inside: avoid;
    }
    .mermaid {
      margin: 1em 0;
      text-align: center;
      page-break-inside: avoid;
    }
    ul, ol { padding-left: 1.4em; }
    strong { color: #111; }
  </style>
  ${mermaidBlocks.length ? '<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>' : ''}
</head>
<body>
${html}
${mermaidBlocks.length ? `<script>
  // Rendered explicitly in generate-plan-pdf.mjs before printing.
</script>` : ''}
</body>
</html>`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PLAN_OUTPUT_NAMES = {
  'version-a/PLAN.md': 'version-a/dolomites-core.pdf',
  'version-b/PLAN.md': 'version-b/garda-iseo-corridor.pdf',
  'version-c/PLAN.md': 'version-c/budget-garda-loop.pdf',
};

async function generatePdf(inputRel, outputRel) {
  const inputPath = path.resolve(root, inputRel);
  const outputPath = path.resolve(
    root,
    outputRel ?? PLAN_OUTPUT_NAMES[inputRel] ?? inputRel.replace(/\.md$/i, '.pdf'),
  );
  const baseDir = path.dirname(inputPath);

  const md = await readFile(inputPath, 'utf8');
  const titleMatch = md.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1] : path.basename(inputPath, '.md');

  const { processed, mermaidBlocks } = preprocessMarkdown(md, baseDir);
  const bodyHtml = await marked.parse(processed, { gfm: true, breaks: false });
  const html = buildHtml(title, bodyHtml, mermaidBlocks);

  const htmlPath = outputPath.replace(/\.pdf$/i, '.html');
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(htmlPath, html, 'utf8');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`file://${htmlPath}`, { waitUntil: 'domcontentloaded' });

  if (mermaidBlocks.length) {
    await page.waitForFunction(() => typeof mermaid !== 'undefined', { timeout: 15000 });
    await page.evaluate(async () => {
      mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
      await mermaid.run({ querySelector: '.mermaid' });
    });
    await page.waitForFunction(() => {
      const blocks = document.querySelectorAll('.mermaid');
      return blocks.length > 0 && [...blocks].every((el) => el.querySelector('svg'));
    }, { timeout: 30000 });
    await page.waitForTimeout(500);
  } else {
    await page.waitForLoadState('networkidle');
  }

  await page.pdf({
    path: outputPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '18mm', right: '16mm', bottom: '18mm', left: '16mm' },
  });

  await browser.close();
  return { inputPath, outputPath, htmlPath };
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const targets = args.length
    ? args
    : ['version-a/PLAN.md', 'version-c/PLAN.md'];

  for (const input of targets) {
    console.log(`Generating PDF for ${input}...`);
    const { outputPath, htmlPath } = await generatePdf(input);
    console.log(`  ✓ ${path.relative(root, outputPath)}`);
    console.log(`  (preview: ${path.relative(root, htmlPath)})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
