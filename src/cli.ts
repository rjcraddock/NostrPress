import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { SimplePool } from "nostr-tools";
import { loadConfig } from "./config/loadConfig.js";
import { resolveIdentity, fetchProfileMetadata, fetchArticles, fetchComments } from "./nostr/client.js";
import { parseArticle } from "./parser/articleParser.js";
import { processMedia, rewriteArticleContent } from "./media/mediaPipeline.js";
import { renderMarkdown, renderSite } from "./render/render.js";
import { Article, Config, RenderContext } from "./types.js";

function parseArgs(): { baseUrl?: string } {
  const args = process.argv.slice(2);
  let baseUrl: string | undefined;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base-url" && i + 1 < args.length) {
      baseUrl = args[i + 1];
      break;
    }
  }
  
  return { baseUrl };
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanOutput(outputDir: string) {
  ensureDir(outputDir);
  ensureDir(path.join(outputDir, "assets", "images"));
  ensureDir(path.join(outputDir, "assets", "videos"));
  ensureDir(path.join(outputDir, "css"));
  ensureDir(path.join(outputDir, "js"));
}

function normalizeSummary(content: string, summary?: string): string {
  if (summary && summary.trim()) return summary;
  const text = content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[#>*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 180);
}

function sortArticles(articles: Article[]): Article[] {
  return [...articles].sort((a, b) => {
    if (b.published_at !== a.published_at) return b.published_at - a.published_at;
    return a.id.localeCompare(b.id);
  });
}

function buildContext(config: Config, npub: string, pubkey: string, profile: any, articles: Article[]): RenderContext {
  const siteTitle = config.site.title === "auto" ? profile.display_name || profile.name || npub : config.site.title;
  const siteDescription =
    config.site.description === "auto" ? profile.about || `Posts by ${siteTitle}` : config.site.description;

  return {
    site: {
      title: siteTitle,
      description: siteDescription,
      base_url: config.site.base_url
    },
    author: {
      npub,
      pubkey,
      profile
    },
    articles
  };
}

function writeStaticAssets(outputDir: string) {
  const srcJs = path.resolve("src/static/site.js");
  const destJs = path.join(outputDir, "js", "site.js");
  if (fs.existsSync(srcJs)) {
    fs.copyFileSync(srcJs, destJs);
  } else {
    fs.writeFileSync(destJs, "");
  }
}

function generateRss(context: RenderContext, outputDir: string) {
  const items = context.articles
    .map((article) => {
      const url = `${context.site.base_url}/${article.slug}.html`;
      return `\n    <item>\n      <title><![CDATA[${article.title}]]></title>\n      <link>${url}</link>\n      <guid>${url}</guid>\n      <pubDate>${new Date(article.published_at).toUTCString()}</pubDate>\n      <description><![CDATA[${article.summary}]]></description>\n    </item>`;
    })
    .join("");

  const rss = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title><![CDATA[${context.site.title}]]></title>\n    <link>${context.site.base_url}</link>\n    <description><![CDATA[${context.site.description}]]></description>${items}\n  </channel>\n</rss>`;

  fs.writeFileSync(path.join(outputDir, "rss.xml"), rss);
}

function generateSitemap(context: RenderContext, outputDir: string) {
  const urls: string[] = [];
  urls.push(`${context.site.base_url}/`);
  urls.push(`${context.site.base_url}/author/`);

  for (const article of context.articles) {
    urls.push(`${context.site.base_url}/${article.slug}.html`);
  }

  const tagSet = new Set<string>();
  for (const article of context.articles) {
    for (const tag of article.tags) tagSet.add(tag);
  }
  for (const tag of tagSet) {
    urls.push(`${context.site.base_url}/tags/${tag}/`);
  }

  const entries = urls
    .map((url) => `  <url><loc>${url}</loc></url>`)
    .join("\n");

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>`;
  fs.writeFileSync(path.join(outputDir, "sitemap.xml"), sitemap);
}

async function run() {
  const args = parseArgs();
  const config = loadConfig(args.baseUrl);
  if (!config.input.npub_or_nprofile) {
    throw new Error("NPUB environment variable is required");
  }

  const identity = resolveIdentity(config.input.npub_or_nprofile, config.relays);
  const pool = new SimplePool();

  const profile = await fetchProfileMetadata(pool, identity.relays, identity.pubkey);
  const events = await fetchArticles(pool, config, identity.pubkey);

  const parsed = events.map(parseArticle);
  const sorted = sortArticles(parsed);

  const withSummary = sorted.map((article) => ({
    ...article,
    summary: normalizeSummary(article.content, article.summary)
  }));

  // Fetch comments for all articles
  const articleEventIds = withSummary.map(a => a.id);
  const commentsMap = await fetchComments(pool, identity.relays, articleEventIds);
  await pool.close(identity.relays);

  // Attach comments to articles
  const withComments = withSummary.map((article) => ({
    ...article,
    comments: commentsMap.get(article.id) || []
  }));

  cleanOutput(config.output_dir);

  const mediaResult = await processMedia(withComments, config);
  const rewritten = withComments.map((article) => rewriteArticleContent(article, mediaResult.urlMap));

  const rendered = rewritten.map((article) => ({
    ...article,
    html: renderMarkdown(article)
  }));

  const context = buildContext(config, identity.npub, identity.pubkey, profile, rendered);
  renderSite(context, config.output_dir);
  writeStaticAssets(config.output_dir);
  generateRss(context, config.output_dir);
  generateSitemap(context, config.output_dir);
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
