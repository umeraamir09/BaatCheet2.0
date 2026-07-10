import type { ButtonHTMLAttributes, ReactNode } from "react";

type IconButtonVariant = "default" | "selected" | "danger" | "success" | "ghost";
type IconButtonSize = "sm" | "md" | "lg";

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  label: string;
  title?: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  children: ReactNode;
}

const sizeClasses: Record<IconButtonSize, string> = {
  sm: "h-9 w-9",
  md: "h-10 w-10",
  lg: "h-12 w-12",
};

const variantClasses: Record<IconButtonVariant, string> = {
  default:
    "bg-discord-control text-discord-muted hover:bg-discord-control-hover hover:text-discord-text",
  selected: "bg-discord-blurple text-white hover:bg-discord-blurple-hover",
  danger: "bg-discord-danger text-white hover:bg-discord-danger-hover",
  success: "bg-discord-success text-white hover:bg-discord-success-hover",
  ghost: "text-discord-muted hover:bg-discord-control hover:text-discord-text",
};

export function IconButton({
  label,
  title,
  variant = "default",
  size = "md",
  className = "",
  children,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      className={`inline-flex shrink-0 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-discord-focus focus-visible:ring-offset-2 focus-visible:ring-offset-discord-bg disabled:cursor-not-allowed disabled:opacity-40 ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
