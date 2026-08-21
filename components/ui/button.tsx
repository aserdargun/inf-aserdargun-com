import type { ButtonHTMLAttributes, ReactNode } from "react";
type ButtonVariant = "primary" | "secondary" | "quiet";
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { children: ReactNode; variant?: ButtonVariant; }
export function Button({ children, className = "", variant = "primary", type = "button", ...props }: ButtonProps) { return <button className={`button button--${variant} ${className}`.trim()} type={type} {...props}>{children}</button>; }
