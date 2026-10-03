// apps/admin/src/components/text-input.tsx
import { forwardRef, type InputHTMLAttributes } from "react";

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...props }, ref) {
    return (
      <input
        {...props}
        ref={ref}
        className={`rounded border border-gray-300 px-3 py-2 ${className ?? ""}`}
      />
    );
  },
);
