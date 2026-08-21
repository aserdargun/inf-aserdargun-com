import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
type ButtonVariant = "primary" | "secondary" | "quiet";
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { children: ReactNode; variant?: ButtonVariant; }
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ children, className = "", variant = "primary", type = "button", ...props }, ref) { return <button className={`button button--${variant} ${className}`.trim()} ref={ref} type={type} {...props}>{children}</button>; });
