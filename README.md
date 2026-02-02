# NostrPress

## About Nostr

Nostr (Notes and Other Stuff Transmitted by Relays) is an open protocol for decentralized social apps. It aims to replace chat, microblogging, and full blogging with a simple, interoperable spec.

Links:

- https://nostr.com
- https://github.com/nostr-protocol/nostr

## What is NostrPress?

Generate a modern static blog from your Nostr long-form posts (kind 30023).

### Why

Blogs on Nostr are great, but they have drawbacks:

- Discoverability is limited to relay coverage and client UX.
- SEO is weak compared to traditional sites.
- Media hosting can be unreliable or fragmented.
- Long-term archiving depends on relay retention policies.

Since Medium is not great and is full of ads, the best option is to self-host your blog. The problem: you have to manage hosting, themes, SEO, RSS, media, and deployment.

So we built NostrPress. It takes your blogs (also called articles) from Nostr and builds a static blog from them. That means you get your content in two places: on the Nostr network and on a SEO-optimized, full static website.

## Quick Deploy

[![Deploy with Vercel](https://vercel.com/button)](<https://vercel.com/new/clone?repository-url=https://github.com/besoeasy/NostrPress&env=NPUB&envDescription=Your%20Nostr%20public%20key%20(npub1...)&project-name=nostrpress-blog>)
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/besoeasy/NostrPress)
[![Deploy to Cloudflare Pages](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/besoeasy/NostrPress)

Click a button above to deploy. You'll be prompted to enter your `NPUB`.

## Run via npx (GitHub)

No install needed. This uses the latest code from the repo:

```bash
NPUB=nostr_public_key npx github:besoeasy/NostrPress
```

With base URL (for production deployment):

```bash
NPUB=nostr_public_key BASE_URL=https://example.com npx github:besoeasy/NostrPress
```

## Build

```bash
NPUB=nostr_public_key npm run build
```

Generates static site in `./dist`

## Deploy

Deploy `dist/` folder to any static host:

- GitHub Pages
- Netlify
- Vercel
- Cloudflare Pages

No configuration needed - works standalone.

## Environment Variables

| Variable      | Required | Description                                                    |
| ------------- | -------- | -------------------------------------------------------------- |
| `NPUB`        | ✅       | Your Nostr public key                                          |
| `RELAYS`      | ❌       | Comma-separated relay URLs                                     |
| `OUTPUT_DIR`  | ❌       | Output directory (default: `./dist`)                           |
| `MAX_SIZE_MB` | ❌       | Max media file size (default: 20)                              |
| `BASE_URL`    | ❌       | Base URL for links (default: `.` for relative paths)          |

## Features

- 📝 Pulls long-form posts (kind 30023) and optional kind 1 notes
- 🧾 Reads profile metadata for title and description
- 🧭 Tags and tag archive pages
- 🗂️ Slug generation and summaries
- 🖼️ Featured images + media download, size limits, and de-duplication
- 💬 Nostr comments (kind 1 replies) with author metadata
- ⏱️ Reading time, word count, excerpts, and related posts
- 📰 RSS feed and sitemap
- 🎨 Modern, responsive design
- 📱 Mobile-friendly
- ⚡ Fast static HTML
