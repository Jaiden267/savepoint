import { CircleCheck, CircleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ActionState } from "@/lib/action-state";

/** Success/error banner for a Server Action's ActionState — never renders raw error internals, only the friendly message already produced by the action. */
export function FormAlert({ state }: { state: ActionState }) {
  if (state.status === "idle" || !state.message) return null;

  const isError = state.status === "error";
  return (
    <Alert
      variant={isError ? "destructive" : "default"}
      className={isError ? undefined : "border-success/40 bg-success/10"}
    >
      {isError ? (
        <CircleAlert className="text-destructive" aria-hidden="true" />
      ) : (
        <CircleCheck className="text-success" aria-hidden="true" />
      )}
      <AlertDescription className={isError ? undefined : "text-foreground"}>
        {state.message}
      </AlertDescription>
    </Alert>
  );
}
