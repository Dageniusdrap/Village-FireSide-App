"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/" },
  { label: "Series", href: "/series" },
  { label: "Episodes", href: "/episodes" },
  { label: "Destinations", href: "/destinations" },
  { label: "Contributors", href: "/contributors" },
  { label: "Consents", href: "/consents" },
  { label: "Source Materials", href: "/source-materials" },
  { label: "Inquiries", href: "/inquiries" },
  { label: "Teachers", href: "/teacher-requests" },
  { label: "Users", href: "/users" },
  { label: "Settings", href: "/settings" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex w-56 flex-shrink-0 flex-col gap-1 border-r border-gray-200 bg-gray-50 p-4">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded px-3 py-2 text-sm ${
              isActive ? "bg-[#1F3B2C] text-white" : "text-gray-700 hover:bg-gray-200"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
