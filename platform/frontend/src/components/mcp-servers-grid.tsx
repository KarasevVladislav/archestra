"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { McpCatalogIcon } from "@/components/mcp-catalog-icon";
import { Button } from "@/components/ui/button";
import { useAllProfileTools } from "@/lib/agent-tools.query";
import { useInternalMcpCatalog } from "@/lib/mcp/internal-mcp-catalog.query";
import { useMcpServers } from "@/lib/mcp/mcp-server.query";
import { cn } from "@/lib/utils";

const PER_PAGE = 8;

interface McpServersGridProps {
  profileId: string | null | undefined;
}

export function McpServersGrid({ profileId }: McpServersGridProps) {
  const { data: mcpServers = [] } = useMcpServers();
  const { data: catalogItems = [] } = useInternalMcpCatalog();
  const { data: assignedToolsData } = useAllProfileTools({
    filters: { agentId: profileId ?? "" },
    skipPagination: true,
    enabled: !!profileId,
  });

  const servers = useMemo(() => {
    if (!assignedToolsData?.data) return [];
    const byCatalog = new Map<
      string,
      {
        name: string;
        catalogId: string;
        toolCount: number;
        icon: string | null;
      }
    >();
    for (const at of assignedToolsData.data) {
      const catalogId = at.tool.catalogId;
      if (!catalogId) continue;
      const existing = byCatalog.get(catalogId);
      if (existing) {
        existing.toolCount += 1;
      } else {
        const catalogItem = catalogItems.find((c) => c.id === catalogId);
        const server = mcpServers.find((s) => s.catalogId === catalogId);
        byCatalog.set(catalogId, {
          catalogId,
          name: catalogItem?.name ?? server?.name ?? "MCP Server",
          icon: catalogItem?.icon ?? null,
          toolCount: 1,
        });
      }
    }
    return Array.from(byCatalog.values());
  }, [assignedToolsData, catalogItems, mcpServers]);

  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(servers.length / PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const pageServers = servers.slice(
    safePage * PER_PAGE,
    safePage * PER_PAGE + PER_PAGE,
  );
  const totalTools = servers.reduce((acc, s) => acc + s.toolCount, 0);

  if (servers.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-sm font-semibold tracking-tight">
          Connected MCP servers
        </h2>
        <span className="font-mono text-xs text-muted-foreground">
          {servers.length} servers · {totalTools} tools
        </span>
        {totalPages > 1 && (
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {safePage + 1} / {totalPages}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {pageServers.map((s) => (
          <ServerTile
            key={s.catalogId}
            name={s.name}
            toolCount={s.toolCount}
            icon={s.icon}
            catalogId={s.catalogId}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
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
                onClick={() => setPage(i)}
                aria-label={`Page ${i + 1}`}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === safePage
                    ? "w-4 bg-foreground"
                    : "w-1.5 bg-muted-foreground/30",
                )}
              />
            ))}
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePage === totalPages - 1}
            aria-label="Next page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

function ServerTile({
  name,
  toolCount,
  icon,
  catalogId,
}: {
  name: string;
  toolCount: number;
  icon: string | null;
  catalogId: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-card p-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        <McpCatalogIcon icon={icon} catalogId={catalogId} size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="font-mono text-[11px] text-muted-foreground">
          {toolCount} tool{toolCount === 1 ? "" : "s"}
        </div>
      </div>
      <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
    </div>
  );
}
