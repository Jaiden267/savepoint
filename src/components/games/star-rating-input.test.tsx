import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { StarRatingInput } from "./star-rating-input";

function ControlledHarness({ initial }: { initial: number | null }) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <div>
      <StarRatingInput
        aria-label="Your rating"
        value={value}
        onChange={setValue}
      />
      <button type="button" onClick={() => setValue(null)}>
        Clear
      </button>
      <output data-testid="value">{value ?? "none"}</output>
    </div>
  );
}

describe("StarRatingInput — controlled mode", () => {
  it("calls onChange with the clicked star's value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <StarRatingInput
        aria-label="Your rating"
        value={null}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByLabelText("3.5 stars"));

    expect(onChange).toHaveBeenCalledWith(3.5);
  });

  it("a Clear control calling onChange(null) visibly unchecks every radio — real state, not an imperative DOM mutation", async () => {
    const user = userEvent.setup();
    render(<ControlledHarness initial={4} />);

    expect(screen.getByLabelText("4 stars")).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.getByTestId("value")).toHaveTextContent("none");
    for (const value of [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5]) {
      expect(
        screen.getByLabelText(`${value} star${value === 1 ? "" : "s"}`),
      ).not.toBeChecked();
    }
  });
});

describe("StarRatingInput — uncontrolled mode", () => {
  it("pre-checks the radio matching defaultValue", () => {
    render(
      <StarRatingInput
        aria-label="Rating for this playthrough"
        name="rating"
        defaultValue={2.5}
      />,
    );

    expect(screen.getByLabelText("2.5 stars")).toBeChecked();
    expect(screen.getByLabelText("3 stars")).not.toBeChecked();
  });

  it("fires onChange as a side-effect hook without controlling checked state", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <StarRatingInput aria-label="Rating" name="rating" onChange={onChange} />,
    );

    await user.click(screen.getByLabelText("5 stars"));

    expect(onChange).toHaveBeenCalledWith(5);
    expect(screen.getByLabelText("5 stars")).toBeChecked();
  });
});

describe("StarRatingInput — required", () => {
  it("sets the native required attribute on every radio in the group", () => {
    render(
      <StarRatingInput
        aria-label="Your rating for this review"
        name="rating"
        required
      />,
    );

    for (const value of [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5]) {
      expect(
        screen.getByLabelText(`${value} star${value === 1 ? "" : "s"}`),
      ).toBeRequired();
    }
  });

  it("omits required when not set", () => {
    render(<StarRatingInput aria-label="Rating" name="rating" />);

    expect(screen.getByLabelText("5 stars")).not.toBeRequired();
  });
});

describe("StarRatingInput — focus-visible", () => {
  it("applies the peer-focus-visible class to the sibling label for keyboard focus styling", () => {
    render(<StarRatingInput aria-label="Rating" name="rating" />);

    const label = screen.getByText("3 stars").closest("label");
    expect(label?.className).toContain("peer-focus-visible:ring-2");
  });
});
