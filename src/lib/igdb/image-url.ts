/**
 * Pure IGDB CDN URL construction — no secrets, no network call, safe to
 * import from Client Components (poster cards, the search dialog) as well
 * as server-only mapping code. Deliberately NOT `server-only`, unlike the
 * rest of src/lib/igdb/.
 */

export type IgdbImageSize =
  | "cover_small"
  | "cover_big"
  | "screenshot_med"
  | "screenshot_big"
  | "1080p"
  | "thumb";

/** Builds an IGDB CDN image URL from an image id. */
export function igdbImageUrl(imageId: string, size: IgdbImageSize): string {
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`;
}
