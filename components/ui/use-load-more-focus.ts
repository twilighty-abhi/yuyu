"use client";

import { useCallback, useEffect, useId, useRef } from "react";

/**
 * Keyboard and screen-reader focus for "Load more" / "Show more" lists.
 * Pressing the button disables it while the page loads, and the last page
 * removes it, so focus would otherwise fall back to the document. Once the
 * new rows render, focus moves to the first of them (the row itself, made
 * programmatically focusable, or its radio for a picker), unless the user
 * has already moved focus somewhere else.
 *
 * Give the element whose direct children are the rows `id={listId}`, call
 * `beforeLoadMore()` in the button's click handler, and pass the rendered
 * row count. (An id rather than a ref, so hooks can return it alongside
 * values read during render.)
 */
export function useLoadMoreFocus(count: number, options: { focus?: "row" | "radio" } = {}) {
  const listId = useId();
  const pending = useRef<{ from: number; trigger: Element | null } | null>(null);
  const focusMode = options.focus ?? "row";

  useEffect(() => {
    const request = pending.current;
    if (!request) return;
    // Any change of the row count settles the request: a failed load leaves
    // the count alone, and a later search or filter must not steal focus.
    pending.current = null;
    if (count <= request.from) return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== request.trigger) return;
    const row = document.getElementById(listId)?.children.item(request.from);
    if (!(row instanceof HTMLElement)) return;
    const radio = focusMode === "radio" ? row.querySelector<HTMLElement>('[role="radio"]') : null;
    if (radio) {
      radio.focus();
      return;
    }
    if (!row.hasAttribute("tabindex")) row.setAttribute("tabindex", "-1");
    row.focus();
  }, [count, focusMode, listId]);

  const beforeLoadMore = useCallback(() => {
    pending.current = { from: count, trigger: document.activeElement };
  }, [count]);

  return { listId, beforeLoadMore };
}
