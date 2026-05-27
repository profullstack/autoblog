// src/feeds.ts
function trimRightSlash(s) {
  return s.replace(/\/+$/, "");
}
function trimLeftSlash(s) {
  return s.replace(/^\/+/, "");
}
function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === "string" && v) return new Date(v);
  return /* @__PURE__ */ new Date();
}
function buildSitemapBlogEntries(opts) {
  const base = trimRightSlash(opts.baseUrl);
  const path = `/${trimLeftSlash(trimRightSlash(opts.blogPath ?? "/blog"))}`;
  const changeFrequency = opts.changeFrequency ?? "monthly";
  const priority = opts.priority ?? 0.6;
  return opts.posts.map((p) => ({
    url: `${base}${path}/${p.slug}`,
    lastModified: toDate(p.updatedAt ?? p.publishedAt),
    changeFrequency,
    priority
  }));
}
function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function cdata(s) {
  return `<![CDATA[${s.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;
}
function rfc822(d) {
  return d.toUTCString();
}
function buildRssXml(opts) {
  const base = trimRightSlash(opts.siteUrl);
  const blogPath = `/${trimLeftSlash(trimRightSlash(opts.blogPath ?? "/blog"))}`;
  const channelLink = `${base}${blogPath}`;
  const feedUrl = opts.feedUrl ?? `${base}${blogPath}/rss.xml`;
  const language = opts.language ?? "en";
  const max = opts.maxItems ?? 50;
  const items = [...opts.posts].sort(
    (a, b) => toDate(b.publishedAt).getTime() - toDate(a.publishedAt).getTime()
  ).slice(0, max);
  const lastBuild = items.length ? rfc822(toDate(items[0].updatedAt ?? items[0].publishedAt)) : rfc822(/* @__PURE__ */ new Date());
  const itemXml = items.map((p) => {
    const url = `${base}${blogPath}/${p.slug}`;
    const pubDate = rfc822(toDate(p.publishedAt));
    const description = p.excerpt ? escapeXml(p.excerpt) : "";
    const content = p.html ? `
      <content:encoded>${cdata(p.html)}</content:encoded>` : "";
    const enclosure = p.imageUrl ? `
      <enclosure url="${escapeXml(p.imageUrl)}" type="image/jpeg" length="0" />` : "";
    const categories = (p.categories ?? []).map((c) => `
      <category>${escapeXml(c)}</category>`).join("");
    return `    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${description}</description>${categories}${enclosure}${content}
    </item>`;
  }).join("\n");
  const hubLink = opts.hubUrl ? `
    <atom:link href="${escapeXml(opts.hubUrl)}" rel="hub" />` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(opts.title)}</title>
    <link>${escapeXml(channelLink)}</link>
    <description>${escapeXml(opts.description)}</description>
    <language>${escapeXml(language)}</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />${hubLink}
${itemXml}
  </channel>
</rss>
`;
}
function buildSitemapXml(entries) {
  const urls = entries.map(
    (e) => `  <url>
    <loc>${escapeXml(e.url)}</loc>
    <lastmod>${e.lastModified.toISOString()}</lastmod>
    <changefreq>${e.changeFrequency}</changefreq>
    <priority>${e.priority.toFixed(1)}</priority>
  </url>`
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}
export {
  buildRssXml,
  buildSitemapBlogEntries,
  buildSitemapXml
};
//# sourceMappingURL=feeds.js.map