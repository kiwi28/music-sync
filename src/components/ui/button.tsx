import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const variants = {
  primary:
    "bg-white text-black hover:bg-gray-200 focus-visible:ring-white/30",
  secondary:
    "bg-white/10 text-white hover:bg-white/20 focus-visible:ring-white/30",
  destructive:
    "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500/30",
  ghost:
    "bg-transparent text-white/70 hover:text-white hover:bg-white/10 focus-visible:ring-white/30",
  outline:
    "border border-white/20 bg-transparent text-white hover:bg-white/10 focus-visible:ring-white/30",
} as const;

const sizes = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2.5",
  icon: "h-10 w-10 p-0",
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-lg font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-black",
          "disabled:pointer-events-none disabled:opacity-40",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";

export { Button, type ButtonProps };
