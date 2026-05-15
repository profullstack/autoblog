// Normalized blog-post type — the contract between sender and receiver.
// This is the canonical shape on the wire (inside data.post). Sources
// that have a richer internal model should narrow to this on the way
// out; receivers can extend with source-specific fields on the way in.

export type PostStatus =
  | "published"
  | "draft"
  | "scheduled"
  | "unpublished";

export type Author = {
  id?: string;
  name?: string;
  url?: string;
};

export type FeaturedImage = {
  url: string;
  alt?: string;
};

export type Post = {
  id: string;
  url: string;
  canonical_url?: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  html: string;
  markdown?: string | null;
  status: PostStatus;
  published_at: string;
  updated_at: string;
  author?: Author | null;
  tags: string[];
  categories: string[];
  featured_image?: FeaturedImage | null;
};

// Event types we emit. v1 is published-only; the rest land when the
// upstream features ship.
export const EVENT_TYPES = {
  POST_PUBLISHED: "post.published.v1",
  POST_UPDATED: "post.updated.v1",
  POST_UNPUBLISHED: "post.unpublished.v1",
  POST_DELETED: "post.deleted.v1",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

// CloudEvents v1.0 envelope (https://github.com/cloudevents/spec).
// We pin the fields we always emit; receivers should tolerate
// additional CloudEvents extension fields without breaking.
export type CloudEvent<TData> = {
  specversion: "1.0";
  id: string;
  type: string; // e.g. "com.crawlproof.post.published.v1" — qualified by source's reverse-DNS
  source: string; // URL of the producer
  subject: string; // e.g. "post:<id>"
  time: string; // ISO-8601 / RFC 3339
  datacontenttype: "application/json";
  data: TData;
};

export type PostPublishedEvent = CloudEvent<{ post: Post }>;

// Headers we send / verify per https://www.standardwebhooks.com/. We
// keep the names lower-case in the type so consumers don't trip on
// Node's header-name normalization.
export type SignedHeaders = {
  "webhook-id": string;
  "webhook-timestamp": string; // unix seconds, stringified
  "webhook-signature": string; // "v1,<base64-hmac-sha256>"
};
