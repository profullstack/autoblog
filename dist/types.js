// Normalized blog-post type — the contract between sender and receiver.
// This is the canonical shape on the wire (inside data.post). Sources
// that have a richer internal model should narrow to this on the way
// out; receivers can extend with source-specific fields on the way in.
// Event types we emit. v1 is published-only; the rest land when the
// upstream features ship.
export const EVENT_TYPES = {
    POST_PUBLISHED: "post.published.v1",
    POST_UPDATED: "post.updated.v1",
    POST_UNPUBLISHED: "post.unpublished.v1",
    POST_DELETED: "post.deleted.v1",
};
//# sourceMappingURL=types.js.map