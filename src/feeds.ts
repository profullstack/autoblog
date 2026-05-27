// Sitemap + RSS helpers for blog receivers.
//
// Pure functions over a generic FeedItem. The host wires its own
// post storage (DB, MDX, static array) into these helpers; the SDK
// stays unaware of the persistence layer.
//
// Sitemap entries are returned as plain objects shaped to match
// Next.js's MetadataRoute.Sitemap so the host can spread them into a
// sitemap.ts without an extra adapter. Frameworks that want raw XML
// can wrap them with buildSitemapXml.

export type FeedItem = {
  slug: string;
  title: string;
  /** ISO string or Date. */
  publishedAt: string | Date;
  /** ISO string or Date. Falls back to publishedAt. */
  updatedAt?: string | Date | null;
  excerpt?: string | null;
  /** HTML body for RSS content:encoded. Optional. */
  html?: string | null;
  /** Featured image URL — emitted as <enclosure> when present. */
  imageUrl?: string | null;
};

export type SitemapChangeFreq =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

export type SitemapEntry = {
  url: string;
  lastModified: Date;
  changeFrequency: SitemapChangeFreq;
  priority: number;
};

export type BuildSitemapBlogEntriesOpts = {
  posts: FeedItem[];
  /** Site origin, e.g. "https://crawlproof.com". Trailing slash tolerated. */
  baseUrl: string;
  /** Path prefix the blog mounts at. Default "/blog". */
  blogPath?: string;
  /** Default "monthly". */
  changeFrequency?: SitemapChangeFreq;
  /** Default 0.6. */
  priority?: number;
};

function trimRightSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function trimLeftSlash(s: string): string {
  return s.replace(/^\/+/, "");
}

function toDate(v: string | Date | null | undefined): Date {
  if (v instanceof Date) return v;
  if (typeof v === "string" && v) return new Date(v);
  return new Date();
}

export function buildSitemapBlogEntries(
  opts: BuildSitemapBlogEntriesOpts,
): SitemapEntry[] {
  const base = trimRightSlash(opts.baseUrl);
  const path = `/${trimLeftSlash(trimRightSlash(opts.blogPath ?? "/blog"))}`;
  const changeFrequency = opts.changeFrequency ?? "monthly";
  const priority = opts.priority ?? 0.6;
  return opts.posts.map((p) => ({
    url: `${base}${path}/${p.slug}`,
    lastModified: toDate(p.updatedAt ?? p.publishedAt),
    changeFrequency,
    priority,
  }));
}

// ============================================================
// RSS 2.0
// ============================================================

export type BuildRssXmlOpts = {
  /** Channel title — usually "<Brand> blog". */
  title: string;
  /** Channel description / tagline. */
  description: string;
  /** Site origin, e.g. "https://crawlproof.com". */
  siteUrl: string;
  /** Path the blog mounts at. Default "/blog". */
  blogPath?: string;
  /** Absolute URL of the feed itself, used in atom:link rel=self.
   *  Default `${siteUrl}${blogPath}/rss.xml`. */
  feedUrl?: string;
  /** RFC 5646 language tag. Default "en". */
  language?: string;
  /** Cap items emitted. Default 50. */
  maxItems?: number;
  posts: FeedItem[];
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cdata(s: string): string {
  // Splitting "]]>" across two CDATA sections is the standard trick to
  // make raw HTML safe inside <![CDATA[...]]>.
  return `<![CDATA[${s.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;
}

function rfc822(d: Date): string {
  // Date.toUTCString() already returns RFC 7231 / RFC 822-style date.
  return d.toUTCString();
}

export function buildRssXml(opts: BuildRssXmlOpts): string {
  const base = trimRightSlash(opts.siteUrl);
  const blogPath = `/${trimLeftSlash(trimRightSlash(opts.blogPath ?? "/blog"))}`;
  const channelLink = `${base}${blogPath}`;
  const feedUrl = opts.feedUrl ?? `${base}${blogPath}/rss.xml`;
  const language = opts.language ?? "en";
  const max = opts.maxItems ?? 50;

  // Sort newest-first so the feed always leads with latest, even if
  // the caller passed a different order.
  const items = [...opts.posts]
    .sort(
      (a, b) =>
        toDate(b.publishedAt).getTime() - toDate(a.publishedAt).getTime(),
    )
    .slice(0, max);

  const lastBuild = items.length
    ? rfc822(toDate(items[0]!.updatedAt ?? items[0]!.publishedAt))
    : rfc822(new Date());

  const itemXml = items
    .map((p) => {
      const url = `${base}${blogPath}/${p.slug}`;
      const pubDate = rfc822(toDate(p.publishedAt));
      const description = p.excerpt ? escapeXml(p.excerpt) : "";
      const content = p.html ? `\n      <content:encoded>${cdata(p.html)}</content:encoded>` : "";
      const enclosure = p.imageUrl
        ? `\n      <enclosure url="${escapeXml(p.imageUrl)}" type="image/jpeg" length="0" />`
        : "";
      return `    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${description}</description>${enclosure}${content}
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(opts.title)}</title>
    <link>${escapeXml(channelLink)}</link>
    <description>${escapeXml(opts.description)}</description>
    <language>${escapeXml(language)}</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
${itemXml}
  </channel>
</rss>
`;
}

// ============================================================
// Sitemap XML (optional — for non-Next.js hosts)
// ============================================================

export function buildSitemapXml(entries: SitemapEntry[]): string {
  const urls = entries
    .map(
      (e) =>
        `  <url>
    <loc>${escapeXml(e.url)}</loc>
    <lastmod>${e.lastModified.toISOString()}</lastmod>
    <changefreq>${e.changeFrequency}</changefreq>
    <priority>${e.priority.toFixed(1)}</priority>
  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}
