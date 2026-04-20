"use client";

import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  LLM_PROXY_PROVIDERS,
  type LlmProxyProviderDefinition,
} from "@/lib/llm-proxy/llm-proxy-providers";
import { cn } from "@/lib/utils";

const PER_PAGE = 12;

interface LlmProxyProviderPickerProps {
  selectedId: string | null;
  onSelect: (provider: LlmProxyProviderDefinition) => void;
  providers?: LlmProxyProviderDefinition[];
}

export function LlmProxyProviderPicker({
  selectedId,
  onSelect,
  providers = LLM_PROXY_PROVIDERS,
}: LlmProxyProviderPickerProps) {
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return providers;
    return providers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.tag.toLowerCase().includes(q) ||
        p.sub.toLowerCase().includes(q),
    );
  }, [providers, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset page back to 0 when the search query changes
  useEffect(() => {
    setPage(0);
  }, [query]);

  const start = safePage * PER_PAGE;
  const pageItems = filtered.slice(start, start + PER_PAGE);
  const selected = providers.find((p) => p.id === selectedId) ?? null;

  return (
    <section className="space-y-3" aria-labelledby="llm-proxy-provider-heading">
      <div className="flex flex-wrap items-center gap-3">
        <StepBadge step={1} active={!!selected} />
        <h2
          id="llm-proxy-provider-heading"
          className="text-base font-semibold tracking-tight"
        >
          Select your provider
        </h2>
        <span className="font-mono text-xs text-muted-foreground">
          {selected
            ? selected.name
            : `${filtered.length}${query ? `/${providers.length}` : ""} providers`}
        </span>
        {totalPages > 1 && (
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {safePage + 1} / {totalPages}
          </span>
        )}
        <div className="ml-auto">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search providers…"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {pageItems.length === 0 ? (
          <EmptyResults
            label="providers"
            onClear={() => setQuery("")}
            spanFull
          />
        ) : (
          pageItems.map((p) => (
            <ProviderTile
              key={p.id}
              provider={p}
              selected={selectedId === p.id}
              onSelect={() => onSelect(p)}
            />
          ))
        )}
      </div>

      <Pager page={safePage} totalPages={totalPages} onChange={setPage} />
    </section>
  );
}

function ProviderTile({
  provider,
  selected,
  onSelect,
}: {
  provider: LlmProxyProviderDefinition;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group flex h-full min-h-[88px] flex-col items-start gap-2 rounded-xl border bg-card p-3 text-left transition-all",
        "hover:border-foreground/30",
        selected
          ? "border-primary ring-2 ring-primary/20"
          : "border-border shadow-sm",
      )}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-mono text-[13px] font-bold"
        style={{ background: provider.iconBg, color: provider.iconFg }}
        aria-hidden="true"
      >
        {provider.logo ?? renderGlyph(provider.glyph)}
      </div>
      <div className="min-w-0 w-full">
        <div className="truncate text-[13px] font-semibold tracking-tight">
          {provider.name}
        </div>
        <div className="truncate text-[11.5px] text-muted-foreground">
          {provider.sub}
        </div>
      </div>
    </button>
  );
}

function renderGlyph(glyph: string | undefined) {
  if (!glyph) return null;
  if (glyph === "aws") {
    return (
      <span className="text-[10px] font-extrabold tracking-tight">aws</span>
    );
  }
  return <span>{glyph}</span>;
}

export function StepBadge({ step, active }: { step: number; active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold text-white",
        active ? "bg-primary" : "bg-muted-foreground/40",
      )}
      aria-hidden="true"
    >
      {step}
    </span>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative inline-flex items-center">
      <Search
        className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-[220px] pl-8 pr-7 text-[12.5px]"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-1.5 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

export function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 pt-1">
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7"
        onClick={() => onChange(Math.max(0, page - 1))}
        disabled={page === 0}
        aria-label="Previous page"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      <div className="flex items-center gap-1.5">
        {Array.from({ length: totalPages }).map((_, i) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: pagination dots
            key={i}
            type="button"
            onClick={() => onChange(i)}
            aria-label={`Page ${i + 1}`}
            className={cn(
              "h-1.5 rounded-full transition-all",
              i === page ? "w-4 bg-foreground" : "w-1.5 bg-muted-foreground/30",
            )}
          />
        ))}
      </div>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7"
        onClick={() => onChange(Math.min(totalPages - 1, page + 1))}
        disabled={page === totalPages - 1}
        aria-label="Next page"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function EmptyResults({
  label,
  onClear,
  spanFull,
}: {
  label: string;
  onClear: () => void;
  spanFull?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground",
        spanFull && "col-span-full",
      )}
    >
      No {label} match your search.{" "}
      <button
        type="button"
        onClick={onClear}
        className="font-medium text-primary underline-offset-4 hover:underline"
      >
        Clear
      </button>
    </div>
  );
}
