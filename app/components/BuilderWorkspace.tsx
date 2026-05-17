"use client";

import Link from "next/link";
import type { ReactNode } from "react";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type BuilderRoute = "generate" | "assign" | "refine" | "preview";

export function BuilderWorkspace({
  route,
  title,
  subtitle,
  sidebar,
  children,
  sidebarWidthClass = "w-72",
  onSidebarHoverChange,
}: {
  route: BuilderRoute;
  title: string;
  subtitle?: string;
  sidebar: ReactNode;
  children: ReactNode;
  sidebarWidthClass?: string;
  onSidebarHoverChange?: (hovered: boolean) => void;
}) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#05060a] text-white">
      <aside
        className={cx(
          sidebarWidthClass,
          "flex-shrink-0 border-r border-white/10 bg-[#07090f] overflow-y-auto",
        )}
        onMouseEnter={() => onSidebarHoverChange?.(true)}
        onMouseLeave={() => onSidebarHoverChange?.(false)}
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="border-b border-white/8 pb-4">
            <p className="text-[10px] uppercase tracking-[0.28em] text-white/30">Project Skymap</p>
            <h1 className="mt-1 text-sm font-semibold uppercase tracking-[0.24em] text-white/85">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-2 text-xs leading-relaxed text-white/38">{subtitle}</p>
            )}
          </div>

          <nav className="grid grid-cols-4 gap-2">
            <BuilderRouteLink href="/generate" label="Generate" active={route === "generate"} />
            <BuilderRouteLink href="/assign" label="Assign" active={route === "assign"} />
            <BuilderRouteLink href="/refine" label="Refine" active={route === "refine"} />
            <BuilderRouteLink href="/preview" label="Preview" active={route === "preview"} />
          </nav>

          {sidebar}
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

function BuilderRouteLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "rounded-md border px-3 py-2 text-center text-[10px] uppercase tracking-[0.24em] transition-colors",
        active
          ? "border-indigo-400/40 bg-indigo-500/18 text-indigo-100"
          : "border-white/10 bg-white/[0.03] text-white/38 hover:border-white/18 hover:text-white/65",
      )}
    >
      {label}
    </Link>
  );
}

export function BuilderSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <p className="text-[10px] uppercase tracking-[0.24em] text-white/28">{label}</p>
      {children}
    </section>
  );
}

export function BuilderSubTabs<T extends string>({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: readonly T[];
  activeTab: T;
  onChange: (tab: T) => void;
}) {
  return (
    <div className="flex rounded-md border border-white/10 bg-white/[0.03] p-1">
      {tabs.map(tab => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={cx(
            "flex-1 rounded px-2 py-2 text-[10px] uppercase tracking-[0.24em] transition-colors",
            activeTab === tab
              ? "bg-white/10 text-white/80"
              : "text-white/28 hover:text-white/55",
          )}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
