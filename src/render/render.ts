import fs from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";
import nunjucks from "nunjucks";
import { Article, RenderContext } from "../types.js";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true
});

const sanitizer = (html: string) =>
  sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "h3", "h4", "h5", "h6"]),
    allowedAttributes: {
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "title", "loading"],
      code: ["class"],
      pre: ["class"],
      '*': ["class", "id"]
    },
    allowedSchemes: ["http", "https", "mailto"],
    disallowedTagsMode: "discard"
  });

export function renderMarkdown(article: Article): string {
  const raw = md.render(article.content);
  return sanitizer(raw);
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(target: string, content: string) {
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, content);
}

export function createRenderer(templateDir: string) {
  const env = nunjucks.configure(templateDir, { autoescape: true });
  env.addFilter("date", (value: number, format: string) => {
    const date = new Date(value);
    if (format === "Y-m-d") {
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      const day = String(date.getUTCDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
    return date.toISOString();
  });
  return env;
}

export function renderSite(context: RenderContext, outputDir: string) {
  const templatesDir = path.resolve("src/render/templates");
  const env = createRenderer(templatesDir);

  const articlesSorted = [...context.articles].sort((a, b) => b.published_at - a.published_at);

  const indexHtml = env.render("index.njk", { ...context, articles: articlesSorted });
  writeFile(path.join(outputDir, "index.html"), indexHtml);

  const tagMap = new Map<string, Article[]>();
  for (const article of articlesSorted) {
    for (const tag of article.tags) {
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag)!.push(article);
    }
  }

  for (const article of articlesSorted) {
    const articleHtml = env.render("article.njk", { ...context, article });
    writeFile(path.join(outputDir, `${article.slug}.html`), articleHtml);
  }

  for (const [tag, articles] of tagMap.entries()) {
    const tagHtml = env.render("tag.njk", { ...context, tag, articles });
    writeFile(path.join(outputDir, "tags", tag, "index.html"), tagHtml);
  }
}
