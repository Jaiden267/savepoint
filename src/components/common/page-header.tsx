import type { ReactNode } from "react";
import { Heading, Text } from "@/components/common/typography";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Standard route heading — title, optional description, optional trailing action. */
export function PageHeader({
  title,
  description,
  action,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-wrap items-start justify-between gap-4",
        className,
      )}
    >
      <div>
        <Heading level="h3" as="h1">
          {title}
        </Heading>
        {description ? (
          <Text tone="muted" size="sm" className="mt-1">
            {description}
          </Text>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
