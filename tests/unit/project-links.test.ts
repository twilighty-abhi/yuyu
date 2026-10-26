import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectLinks } from "@/components/event/ProjectLinks";

const render = (links: { repoUrl: string | null; demoUrl: string | null; videoUrl: string | null }) =>
  renderToStaticMarkup(createElement(ProjectLinks, { links, projectTitle: "Demo project" }));

describe("public project links", () => {
  it("renders https links as untrusted user content in a new tab", () => {
    const html = render({ repoUrl: "https://example.com/repo", demoUrl: "https://demo.example.com/", videoUrl: null });
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).toContain('href="https://example.com/repo"');
    expect(html.match(/rel="noopener noreferrer nofollow ugc"/g)).toHaveLength(2);
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
    expect(html).not.toContain("Video");
  });

  it("drops anything that is not a plain https link", () => {
    const html = render({
      repoUrl: "javascript:alert(1)",
      demoUrl: "http://example.com/",
      videoUrl: "https://user:pass@example.com/",
    });
    expect(html).toBe("");
  });
});
