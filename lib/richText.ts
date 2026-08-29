import "server-only";

import sanitizeHtml from "sanitize-html";

/** The event website deliberately supports text formatting, not arbitrary embeds or markup. */
export function sanitizeRichText(value: string) {
  return sanitizeHtml(value, {
    allowedTags: ["p", "br", "strong", "em", "s", "h2", "h3", "ul", "ol", "li", "blockquote", "a"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }),
    },
  }).trim();
}
