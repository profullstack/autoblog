type PostStatus = "published" | "draft" | "scheduled" | "unpublished";
type Author = {
    id?: string;
    name?: string;
    url?: string;
};
type FeaturedImage = {
    url: string;
    alt?: string;
};
type Post = {
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
declare const EVENT_TYPES: {
    readonly POST_PUBLISHED: "post.published.v1";
    readonly POST_UPDATED: "post.updated.v1";
    readonly POST_UNPUBLISHED: "post.unpublished.v1";
    readonly POST_DELETED: "post.deleted.v1";
};
type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];
type CloudEvent<TData> = {
    specversion: "1.0";
    id: string;
    type: string;
    source: string;
    subject: string;
    time: string;
    datacontenttype: "application/json";
    data: TData;
};
type PostPublishedEvent = CloudEvent<{
    post: Post;
}>;
type SignedHeaders = {
    "webhook-id": string;
    "webhook-timestamp": string;
    "webhook-signature": string;
};

export { type Author as A, type CloudEvent as C, EVENT_TYPES as E, type FeaturedImage as F, type Post as P, type SignedHeaders as S, type EventType as a, type PostPublishedEvent as b, type PostStatus as c };
