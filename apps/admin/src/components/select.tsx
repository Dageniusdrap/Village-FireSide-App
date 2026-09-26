// apps/admin/src/components/select.tsx
import { forwardRef, type SelectHTMLAttributes } from "react";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        {...props}
        ref={ref}
        className={`rounded border border-gray-300 bg-white px-3 py-2 ${className ?? ""}`}
      >
        {children}
      </select>
    );
  },
);
