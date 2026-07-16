"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "./providers";
import { Activity, FolderOpen, Headphones, House, Music, Settings } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", Icon: House },
  { href: "/jobs", label: "Jobs", Icon: Activity },
  { href: "/playlists", label: "Playlists", Icon: Music },
  { href: "/files", label: "Files", Icon: FolderOpen },
  { href: "/settings", label: "Settings", Icon: Settings },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();

  if (!user) return null;

  return (
    <aside className="fixed left-0 top-0 z-40 h-full w-56 border-r border-white/5 bg-black/50 backdrop-blur-xl">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-14 items-center gap-2.5 border-b border-white/5 px-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-xs font-black text-black">
            MS
          </div>
          <span className="font-semibold text-sm tracking-tight">
            Music Sync
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-white/50 hover:bg-white/5 hover:text-white"
                )}
              >
                <item.Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* External links */}
        <div className="border-t border-white/5 px-3 py-4">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-white/25">
            Streaming
          </p>
          <a
            href="https://spoty.kiw.ro"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/50 transition-colors hover:bg-white/5 hover:text-white"
          >
            <Headphones className="h-4 w-4" />
            Navidrome
            {/* External link indicator */}
            <svg
              className="ml-auto h-3 w-3 opacity-40"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <path d="M15 3h6v6" />
              <path d="M10 14 21 3" />
            </svg>
          </a>
        </div>

        {/* User section */}
        <div className="border-t border-white/5 p-4">
          <div className="flex items-center gap-3 text-sm">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs font-medium text-white/70">
              {user.email?.charAt(0).toUpperCase()}
            </div>
            <span className="text-white/50 text-xs truncate">
              {user.email}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
