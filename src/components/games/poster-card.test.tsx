import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { PosterCard } from "./poster-card";

vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    children,
    className,
  }: ComponentProps<"a"> & { href: string; prefetch?: boolean }) => (
    <a href={href} data-prefetch={String(prefetch)} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

describe("PosterCard", () => {
  it("disables prefetch for a not-yet-imported IGDB-only result", () => {
    render(
      <PosterCard
        slug="halo-infinite"
        name="Halo Infinite"
        coverImageId={null}
        source="igdb"
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/games/halo-infinite");
    expect(link).toHaveAttribute("data-prefetch", "false");
  });

  it("keeps default prefetch for an already-cached local result", () => {
    render(
      <PosterCard
        slug="halo-infinite"
        name="Halo Infinite"
        coverImageId={null}
        source="local"
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("data-prefetch", "undefined");
  });

  it("renders a no-cover placeholder when there is no cover image", () => {
    render(
      <PosterCard slug="game" name="Game" coverImageId={null} source="local" />,
    );

    expect(screen.getByText("No cover art")).toBeInTheDocument();
  });

  it("renders the cover image via the IGDB CDN when a cover id is present", () => {
    render(
      <PosterCard
        slug="game"
        name="Game"
        coverImageId="co123"
        source="local"
      />,
    );

    // The cover image is intentionally decorative (alt="") since the poster
    // title text already conveys the name — that gives it an implicit
    // "presentation" role, not "img".
    const image = screen.getByRole("presentation");
    expect(image).toHaveAttribute(
      "src",
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co123.jpg",
    );
  });

  it("shows the release year when provided", () => {
    render(
      <PosterCard
        slug="game"
        name="Game"
        coverImageId={null}
        releaseYear={2017}
        source="local"
      />,
    );

    expect(screen.getByText("2017")).toBeInTheDocument();
  });
});
