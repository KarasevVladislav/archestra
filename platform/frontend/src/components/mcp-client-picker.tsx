"use client";

import { Check, Terminal } from "lucide-react";
import { MCP_CLIENTS, type McpClientDefinition } from "@/lib/mcp/mcp-clients";
import { cn } from "@/lib/utils";

interface McpClientPickerProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  clients?: McpClientDefinition[];
}

export function McpClientPicker({
  selectedId,
  onSelect,
  clients = MCP_CLIENTS,
}: McpClientPickerProps) {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold tracking-tight">
        Select your client
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {clients.map((client) => (
          <ClientTile
            key={client.id}
            client={client}
            selected={selectedId === client.id}
            onSelect={() => onSelect(client.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ClientTile({
  client,
  selected,
  onSelect,
}: {
  client: McpClientDefinition;
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
          : "border-border",
      )}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{
          background: client.tileBg ?? "hsl(var(--muted))",
          color: "hsl(var(--foreground))",
        }}
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
