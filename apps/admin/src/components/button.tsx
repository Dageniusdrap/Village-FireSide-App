// apps/admin/src/components/button.tsx
import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
};

const VARIANT_CLASSES: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-[#1F3B2C] text-white hover:bg-[#16291f]",
  secondary: "border border-gray-300 bg-white text-gray-900 hover:bg-gray-50",
  danger: "bg-red-700 text-white hover:bg-red-800",
};

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`rounded px-3 py-2 font-medium disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className ?? ""}`}
    />
  );
}
