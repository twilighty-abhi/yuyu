import type { MDXComponents } from "mdx/types";
import { helpMdxComponents } from "@/components/help/mdx";

// Required by @next/mdx in the App Router. The guide (content/help) is the
// only MDX in the app, so its components are the global set.
export function useMDXComponents(): MDXComponents {
  return helpMdxComponents;
}
