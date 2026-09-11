import { cn } from "@/lib/utils";
import { STATUS_CLASSE, STATUS_LABEL, type PieceStatus } from "@/lib/aprova";

export interface StatusBadgeProps {
  status: PieceStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        STATUS_CLASSE[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
