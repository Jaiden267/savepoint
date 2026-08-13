/** Shared result shape for useActionState-driven Server Actions. */
export interface ActionState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** Set only by signUpAction on success, so the client can prefill a
   * resend-confirmation form with the just-submitted address without
   * lifting a parallel useState. Every other action leaves it undefined. */
  email?: string;
}

export const initialActionState: ActionState = { status: "idle" };
