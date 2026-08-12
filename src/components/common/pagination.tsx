import { LinkButton } from "@/components/common/link-button";

interface PaginationProps {
  page: number;
  hasMore: boolean;
  makeHref: (page: number) => string;
}

/** Prev/next pager — each route owns its own query-string shape via `makeHref`. */
export function Pagination({ page, hasMore, makeHref }: PaginationProps) {
  return (
    <nav
      className="mt-8 flex items-center justify-between"
      aria-label="Pagination"
    >
      {page > 1 ? (
        <LinkButton variant="secondary" size="sm" href={makeHref(page - 1)}>
          Previous
        </LinkButton>
      ) : (
        <span />
      )}
      {hasMore ? (
        <LinkButton variant="secondary" size="sm" href={makeHref(page + 1)}>
          Next
        </LinkButton>
      ) : (
        <span />
      )}
    </nav>
  );
}
