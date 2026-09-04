import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
type ButtonVariant = "primary" | "secondary" | "quiet" | "destructive";
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { children: ReactNode; pending?: boolean; variant?: ButtonVariant; }
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ children, className = "", pending = false, variant = "primary", type = "button", ...props }, ref) { return <button {...props} aria-busy={pending || undefined} className={`button button--${variant} ${className}`.trim()} ref={ref} type={type}>{children}</button>; });
