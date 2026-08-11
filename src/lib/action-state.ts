/** Shared result shape for useActionState-driven Server Actions. */
export interface ActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

export const initialActionState: ActionState = { status: "idle" };
