import { describe, it, expect } from "vitest";
import {
  buildSitemapBlogEntries,
  buildRssXml,
  buildSitemapXml,
  type FeedItem,
} from "../src/feeds.js";

function makeItem(over: Partial<FeedItem> = {}): FeedItem {
  return {
    slug: "hello-world",
    title: "Hello world",
    publishedAt: "2026-05-10T12:00:00Z",
    excerpt: "An excerpt.",
    html: "<p>Body</p>",
    ...over,
  };
}

describe("buildSitemapBlogEntries", () => {
  it("emits one entry per post with full URL", () => {
    const entries = buildSitemapBlogEntries({
      posts: [makeItem({ slug: "a" }), makeItem({ slug: "b" })],
      baseUrl: "https://example.com",
    });
    expect(entries.map((e) => e.url)).toEqual([
      "https://example.com/blog/a",
      "https://example.com/blog/b",
    ]);
  });

  it("normalizes trailing slash on baseUrl and blogPath", () => {
    const [entry] = buildSitemapBlogEntries({
      posts: [makeItem({ slug: "x" })],
      baseUrl: "https://example.com/",
      blogPath: "/articles/",
    });
    expect(entry!.url).toBe("https://example.com/articles/x");
  });

  it("uses updatedAt when present, else publishedAt", () => {
    const [a, b] = buildSitemapBlogEntries({
      posts: [
        makeItem({
          slug: "a",
          publishedAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-04-04T00:00:00Z",
        }),
        makeItem({ slug: "b", publishedAt: "2026-02-02T00:00:00Z" }),
      ],
      baseUrl: "https://example.com",
    });
    expect(a!.lastModified.toISOString()).toBe("2026-04-04T00:00:00.000Z");
    expect(b!.lastModified.toISOString()).toBe("2026-02-02T00:00:00.000Z");
  });

  it("respects priority/changeFrequency overrides", () => {
    const [entry] = buildSitemapBlogEntries({
      posts: [makeItem()],
      baseUrl: "https://example.com",
      priority: 0.9,
      changeFrequency: "daily",
    });
    expect(entry!.priority).toBe(0.9);
    expect(entry!.changeFrequency).toBe("daily");
  });
});

describe("buildRssXml", () => {
  it("emits a well-formed feed with one item", () => {
    const xml = buildRssXml({
      title: "My blog",
      description: "About things",
      siteUrl: "https://example.com",
      posts: [makeItem()],
    });
    expect(xml).toMatch(/<rss version="2.0"/);
    expect(xml).toContain("<title>My blog</title>");
    expect(xml).toContain("<link>https://example.com/blog</link>");
    expect(xml).toContain(
      '<atom:link href="https://example.com/blog/rss.xml" rel="self" type="application/rss+xml" />',
    );
    expect(xml).toContain(
      "<guid isPermaLink=\"true\">https://example.com/blog/hello-world</guid>",
    );
    expect(xml).toContain("<content:encoded><![CDATA[<p>Body</p>]]></content:encoded>");
  });

  it("escapes special chars in titles + excerpts", () => {
    const xml = buildRssXml({
      title: 'A & "B" <c>',
      description: "x",
      siteUrl: "https://example.com",
      posts: [makeItem({ title: "Tom & Jerry <fight>", excerpt: 'quoted "stuff"' })],
    });
    expect(xml).toContain("Tom &amp; Jerry &lt;fight&gt;");
    expect(xml).toContain("quoted &quot;stuff&quot;");
    expect(xml).toContain('<title>A &amp; &quot;B&quot; &lt;c&gt;</title>');
  });

  it("splits ]]> inside CDATA safely", () => {
    const xml = buildRssXml({
      title: "t",
      description: "d",
      siteUrl: "https://example.com",
      posts: [makeItem({ html: "<p>edge]]>case</p>" })],
    });
    expect(xml).not.toContain("edge]]>case");
    expect(xml).toContain("]]]]><![CDATA[>");
  });

  it("sorts newest-first regardless of input order", () => {
    const xml = buildRssXml({
      title: "t",
      description: "d",
      siteUrl: "https://example.com",
      posts: [
        makeItem({ slug: "old", publishedAt: "2026-01-01T00:00:00Z" }),
        makeItem({ slug: "new", publishedAt: "2026-05-01T00:00:00Z" }),
      ],
    });
    expect(xml.indexOf("/blog/new")).toBeLessThan(xml.indexOf("/blog/old"));
  });

  it("caps items at maxItems", () => {
    const items = Array.from({ length: 75 }, (_, i) =>
      makeItem({ slug: `p${i}`, publishedAt: `2026-05-${(i % 28) + 1}T00:00:00Z` }),
    );
    const xml = buildRssXml({
      title: "t",
      description: "d",
      siteUrl: "https://example.com",
      posts: items,
      maxItems: 10,
    });
    expect((xml.match(/<item>/g) || []).length).toBe(10);
  });

  it("emits enclosure when imageUrl is set", () => {
    const xml = buildRssXml({
      title: "t",
      description: "d",
      siteUrl: "https://example.com",
      posts: [makeItem({ imageUrl: "https://cdn.example.com/x.jpg" })],
    });
    expect(xml).toContain(
      '<enclosure url="https://cdn.example.com/x.jpg" type="image/jpeg" length="0" />',
    );
  });

  it("uses custom feedUrl when provided", () => {
    const xml = buildRssXml({
      title: "t",
      description: "d",
      siteUrl: "https://example.com",
      feedUrl: "https://example.com/feed",
      posts: [makeItem()],
    });
    expect(xml).toContain('href="https://example.com/feed"');
  });
});

describe("buildSitemapXml", () => {
  it("emits a urlset with one url per entry", () => {
    const entries = buildSitemapBlogEntries({
      posts: [makeItem({ slug: "a" }), makeItem({ slug: "b" })],
      baseUrl: "https://example.com",
    });
    const xml = buildSitemapXml(entries);
    expect(xml).toMatch(/<urlset/);
    expect((xml.match(/<url>/g) || []).length).toBe(2);
    expect(xml).toContain("<loc>https://example.com/blog/a</loc>");
  });
});
