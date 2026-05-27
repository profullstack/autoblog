type FeedItem = {
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
type SitemapChangeFreq = "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
type SitemapEntry = {
    url: string;
    lastModified: Date;
    changeFrequency: SitemapChangeFreq;
    priority: number;
};
type BuildSitemapBlogEntriesOpts = {
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
declare function buildSitemapBlogEntries(opts: BuildSitemapBlogEntriesOpts): SitemapEntry[];
type BuildRssXmlOpts = {
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
declare function buildRssXml(opts: BuildRssXmlOpts): string;
declare function buildSitemapXml(entries: SitemapEntry[]): string;

export { type BuildRssXmlOpts, type BuildSitemapBlogEntriesOpts, type FeedItem, type SitemapChangeFreq, type SitemapEntry, buildRssXml, buildSitemapBlogEntries, buildSitemapXml };
