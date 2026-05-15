export type PostStatus = "published" | "draft" | "scheduled" | "unpublished";
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
export declare const EVENT_TYPES: {
    readonly POST_PUBLISHED: "post.published.v1";
    readonly POST_UPDATED: "post.updated.v1";
    readonly POST_UNPUBLISHED: "post.unpublished.v1";
    readonly POST_DELETED: "post.deleted.v1";
};
export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];
export type CloudEvent<TData> = {
    specversion: "1.0";
    id: string;
    type: string;
    source: string;
    subject: string;
    time: string;
    datacontenttype: "application/json";
    data: TData;
};
export type PostPublishedEvent = CloudEvent<{
    post: Post;
}>;
export type SignedHeaders = {
    "webhook-id": string;
    "webhook-timestamp": string;
    "webhook-signature": string;
};
//# sourceMappingURL=types.d.ts.map