// apps/admin/src/components/toggle.tsx
import { forwardRef, type InputHTMLAttributes } from "react";

type ToggleProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
};

// A plain labeled checkbox rendered to look like a toggle via accent-color
// — no new dependency for a visual switch. `register()` spreads onto this
// exactly as it would onto a raw `<input type="checkbox">`.
export const Toggle = forwardRef<HTMLInputElement, ToggleProps>(function Toggle(
  { label, className, ...props },
  ref,
) {
  return (
    <label className={`flex items-center gap-2 ${className ?? ""}`}>
      <input {...props} ref={ref} type="checkbox" className="h-5 w-5 accent-[#1F3B2C]" />
      <span>{label}</span>
    </label>
  );
});
