"use client";

import { Check, Terminal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  EmptyResults,
  Pager,
  SearchInput,
  StepBadge,
} from "@/components/llm-proxy/llm-proxy-provider-picker";
import {
  LLM_PROXY_CLIENTS,
  type LlmProxyClientDefinition,
} from "@/lib/llm-proxy/llm-proxy-clients";
import type { LlmProxyProviderDefinition } from "@/lib/llm-proxy/llm-proxy-providers";
import { cn } from "@/lib/utils";

const PER_PAGE = 8;

interface LlmProxyClientPickerProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** When set, filter clients to those whose `supports` includes the provider's wire. */
  provider: LlmProxyProviderDefinition | null;
  disabled?: boolean;
}

export function LlmProxyClientPicker({
  selectedId,
  onSelect,
  provider,
  disabled,
}: LlmProxyClientPickerProps) {
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");

  const compatible = useMemo(
    () =>
      provider
        ? LLM_PROXY_CLIENTS.filter((c) => c.supports.includes(provider.wire))
        : LLM_PROXY_CLIENTS,
    [provider],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return compatible;
    return compatible.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.sub.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q),
    );
  }, [compatible, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset page back to 0 when the search query or provider changes
  useEffect(() => {
    setPage(0);
  }, [query, provider?.id]);

  const start = safePage * PER_PAGE;
  const pageItems = filtered.slice(start, start + PER_PAGE);

  return (
    <section
      className={cn(
        "space-y-3 transition-opacity",
        disabled && "pointer-events-none opacity-50",
      )}
      aria-labelledby="llm-proxy-client-heading"
      aria-disabled={disabled || undefined}
    >
      <div className="flex flex-wrap items-center gap-3">
        <StepBadge step={2} active={!!selectedId && !disabled} />
        <h2
          id="llm-proxy-client-heading"
          className="text-base font-semibold tracking-tight"
        >
          Select your client
        </h2>
        <span className="font-mono text-xs text-muted-foreground">
          {filtered.length}
          {query ? `/${compatible.length}` : ""} clients
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
            placeholder="Search clients…"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4">
        {pageItems.length === 0 ? (
          <EmptyResults label="clients" onClear={() => setQuery("")} spanFull />
        ) : (
          pageItems.map((c) => (
            <ClientTile
              key={c.id}
              client={c}
              selected={selectedId === c.id}
              onSelect={() => onSelect(c.id)}
            />
          ))
        )}
      </div>

      <Pager page={safePage} totalPages={totalPages} onChange={setPage} />
    </section>
  );
}

function ClientTile({
  client,
  selected,
  onSelect,
}: {
  client: LlmProxyClientDefinition;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg border bg-card p-3 text-left transition-all",
        "hover:border-foreground/30",
        selected
          ? "border-primary ring-2 ring-primary/20"
          : "border-border shadow-sm",
      )}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border"
        style={{
          background: client.tileBg ?? "hsl(var(--muted))",
          borderColor: "hsl(var(--border))",
        }}
        aria-hidden="true"
      >
        {client.icon ?? <Terminal className="h-5 w-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold tracking-tight">
          {client.label}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {client.sub}
        </div>
      </div>
      {selected && (
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3 w-3" strokeWidth={3} />
        </div>
      )}
    </button>
  );
}
