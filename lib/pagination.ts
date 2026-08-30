export function paginationWindow(currentPage: number, totalPages: number, size = 7): number[] {
  if (totalPages <= 0 || size <= 0) return [];
  const safeCurrent = Math.min(Math.max(1, currentPage), totalPages);
  const windowSize = Math.min(Math.max(1, size), totalPages);
  let start = Math.max(1, safeCurrent - Math.floor(windowSize / 2));
  const end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
