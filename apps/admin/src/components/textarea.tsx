// apps/admin/src/components/textarea.tsx
import { forwardRef, type TextareaHTMLAttributes } from "react";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={`rounded border border-gray-300 px-3 py-2 ${className ?? ""}`}
    />
  );
});
