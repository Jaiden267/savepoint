/** Accessible inline field-level error text, wired to an input via aria-describedby. */
export function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return (
    <p id={id} role="alert" className="text-destructive text-xs">
      {errors[0]}
    </p>
  );
}
