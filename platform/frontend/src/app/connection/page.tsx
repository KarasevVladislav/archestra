"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { A2AConnectionInstructions } from "@/components/a2a-connection-instructions";
import { AgentIcon, type AgentIconVariant } from "@/components/agent-icon";
import type { ArchitectureTabType } from "@/components/architecture-diagram/architecture-diagram";
import { LlmProxyFlow } from "@/components/llm-proxy/llm-proxy-flow";
import { McpClientInstructions } from "@/components/mcp-client-instructions";
import { McpClientPicker } from "@/components/mcp-client-picker";
import { McpServersGrid } from "@/components/mcp-servers-grid";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useDefaultLlmProxy,
  useDefaultMcpGateway,
  useInternalAgents,
  useProfiles,
} from "@/lib/agent.query";
import { getMcpClient, MCP_CLIENTS } from "@/lib/mcp/mcp-clients";
import { cn } from "@/lib/utils";

type GatewayType = ArchitectureTabType;

const GATEWAY_TYPES: Array<{
  id: GatewayType;
  label: string;
  dot: string;
}> = [
  { id: "proxy", label: "LLM Proxy", dot: "bg-blue-500" },
  { id: "mcp", label: "MCP Gateway", dot: "bg-cyan-600" },
  { id: "a2a", label: "A2A", dot: "bg-violet-600" },
];

const BACK_LINK: Record<GatewayType, { href: string; label: string }> = {
  mcp: { href: "/mcp/gateways", label: "All MCP Gateways" },
  proxy: { href: "/llm/proxies", label: "All LLM Proxies" },
  a2a: { href: "/agents", label: "All A2A Agents" },
};

const HERO_COPY: Record<
  GatewayType,
  { headline: React.ReactNode; sub: string }
> = {
  mcp: {
    headline: (
      <>
        Connect your AI tools to the data to{" "}
        <span className="bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">
          make them even more powerful
        </span>
      </>
    ),
    sub: "One endpoint. Every MCP your team is allowed to use. Credentials, policy, audit — handled.",
  },
  proxy: {
    headline: (
      <>
        Route every prompt through{" "}
        <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
          one governed endpoint
        </span>
      </>
    ),
    sub: "One base URL, every provider. Budgets, guardrails, and observability in front of every call.",
  },
  a2a: {
    headline: (
      <>
        Let your agents{" "}
        <span className="bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
          talk to each other
        </span>
        , safely
      </>
    ),
    sub: "Expose internal agents over A2A. Delegation, signed messages, and traceable hand-offs.",
  },
};

export default function ConnectionPage() {
  const { data: defaultMcpGateway } = useDefaultMcpGateway();
  const { data: defaultLlmProxy } = useDefaultLlmProxy();
  const { data: mcpGateways } = useProfiles({
    filters: { agentTypes: ["profile", "mcp_gateway"] },
  });
  const { data: llmProxies } = useProfiles({
    filters: { agentTypes: ["profile", "llm_proxy"] },
  });
  const { data: internalAgents } = useInternalAgents();

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const idParam = searchParams.get("id");
  const fromTable = searchParams.get("from") === "table";

  const [gatewayType, setGatewayType] = useState<GatewayType>(
    tabParam === "mcp" ? "mcp" : tabParam === "a2a" ? "a2a" : "proxy",
  );

  useEffect(() => {
    if (tabParam === "mcp" || tabParam === "proxy" || tabParam === "a2a") {
      setGatewayType(tabParam);
    }
  }, [tabParam]);

  const updateUrl = useCallback(
    (next: { tab?: GatewayType; id?: string | null }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.tab !== undefined) params.set("tab", next.tab);
      if (next.id !== undefined) {
        if (next.id) params.set("id", next.id);
        else params.delete("id");
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const [selectedMcpGatewayId, setSelectedMcpGatewayId] = useState<
    string | null
  >(null);
  const effectiveMcpGatewayId =
    selectedMcpGatewayId ??
    defaultMcpGateway?.id ??
    mcpGateways?.[0]?.id ??
    null;
  const selectedMcpGateway = useMemo(
    () => mcpGateways?.find((g) => g.id === effectiveMcpGatewayId) ?? null,
    [mcpGateways, effectiveMcpGatewayId],
  );

  const [selectedLlmProxyId, setSelectedLlmProxyId] = useState<string | null>(
    null,
  );
  const effectiveLlmProxyId =
    selectedLlmProxyId ?? defaultLlmProxy?.id ?? llmProxies?.[0]?.id ?? null;
  const selectedLlmProxy =
    llmProxies?.find((p) => p.id === effectiveLlmProxyId) ?? null;

  const [selectedA2aAgentId, setSelectedA2aAgentId] = useState<string | null>(
    null,
  );
  const effectiveA2aAgentId =
    selectedA2aAgentId ?? internalAgents?.[0]?.id ?? null;
  const selectedA2aAgent =
    internalAgents?.find((a) => a.id === effectiveA2aAgentId) ?? null;

  // Hydrate selection from `id` URL param once the relevant list has loaded.
  useEffect(() => {
    if (!idParam) return;
    if (gatewayType === "mcp" && mcpGateways?.some((g) => g.id === idParam)) {
      setSelectedMcpGatewayId(idParam);
    } else if (
      gatewayType === "proxy" &&
      llmProxies?.some((p) => p.id === idParam)
    ) {
      setSelectedLlmProxyId(idParam);
    } else if (
      gatewayType === "a2a" &&
      internalAgents?.some((a) => a.id === idParam)
    ) {
      setSelectedA2aAgentId(idParam);
    }
  }, [idParam, gatewayType, mcpGateways, llmProxies, internalAgents]);

  // Keep `id` param in sync with the effective selection for the active tab.
  const effectiveSelectedId =
    gatewayType === "mcp"
      ? effectiveMcpGatewayId
      : gatewayType === "proxy"
        ? effectiveLlmProxyId
        : effectiveA2aAgentId;
  useEffect(() => {
    if (idParam || !effectiveSelectedId) return;
    updateUrl({ id: effectiveSelectedId });
  }, [effectiveSelectedId, idParam, updateUrl]);

  const selectGatewayType = useCallback(
    (next: GatewayType) => {
      setGatewayType(next);
      const nextId =
        next === "mcp"
          ? effectiveMcpGatewayId
          : next === "proxy"
            ? effectiveLlmProxyId
            : effectiveA2aAgentId;
      updateUrl({ tab: next, id: nextId });
    },
    [effectiveMcpGatewayId, effectiveLlmProxyId, effectiveA2aAgentId, updateUrl],
  );

  const handleSelectMcpGateway = useCallback(
    (id: string) => {
      setSelectedMcpGatewayId(id);
      updateUrl({ id });
    },
    [updateUrl],
  );
  const handleSelectLlmProxy = useCallback(
    (id: string) => {
      setSelectedLlmProxyId(id);
      updateUrl({ id });
    },
    [updateUrl],
  );
  const handleSelectA2aAgent = useCallback(
    (id: string) => {
      setSelectedA2aAgentId(id);
      updateUrl({ id });
    },
    [updateUrl],
  );

  const [clientId, setClientId] = useState<string>(MCP_CLIENTS[0].id);
  const selectedClient = getMcpClient(clientId) ?? MCP_CLIENTS[0];

  const copy = HERO_COPY[gatewayType];

  return (
    <div className="w-full">
      {/* Sticky top bar: back link + gateway type selector + instance picker */}
      <div className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex w-full max-w-[1680px] flex-wrap items-center gap-3 px-6 py-3">
          {fromTable && (
            <Link
              href={BACK_LINK[gatewayType].href}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
              {BACK_LINK[gatewayType].label}
            </Link>
          )}

          <div className="ml-auto inline-flex rounded-lg border bg-muted/60 p-1">
            {GATEWAY_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => selectGatewayType(t.id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition-all",
                  gatewayType === t.id
                    ? "bg-card text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    gatewayType === t.id ? t.dot : "bg-muted-foreground/40",
                  )}
                />
                {t.label}
              </button>
            ))}
          </div>

          <div>
            {gatewayType === "mcp" && (mcpGateways?.length ?? 0) > 0 && (
              <InstanceSelect
                label="MCP Gateway"
                value={effectiveMcpGatewayId ?? ""}
                onChange={handleSelectMcpGateway}
                fallbackType="mcp_gateway"
                items={
                  mcpGateways?.map((g) => ({
                    id: g.id,
                    name: g.name,
                    icon: g.icon,
                  })) ?? []
                }
                selectedItem={
                  selectedMcpGateway
                    ? {
                        id: selectedMcpGateway.id,
                        name: selectedMcpGateway.name,
                        icon: selectedMcpGateway.icon,
                      }
                    : null
                }
              />
            )}
            {gatewayType === "proxy" && (llmProxies?.length ?? 0) > 0 && (
              <InstanceSelect
                label="LLM Proxy"
                value={effectiveLlmProxyId ?? ""}
                onChange={handleSelectLlmProxy}
                fallbackType="llm_proxy"
                items={
                  llmProxies?.map((p) => ({
                    id: p.id,
                    name: p.name,
                    icon: p.icon,
                  })) ?? []
                }
                selectedItem={
                  selectedLlmProxy
                    ? {
                        id: selectedLlmProxy.id,
                        name: selectedLlmProxy.name,
                        icon: selectedLlmProxy.icon,
                      }
                    : null
                }
              />
            )}
            {gatewayType === "a2a" && (internalAgents?.length ?? 0) > 0 && (
              <InstanceSelect
                label="A2A Agent"
                value={effectiveA2aAgentId ?? ""}
                onChange={handleSelectA2aAgent}
                fallbackType="agent"
                items={
                  internalAgents?.map((a) => ({
                    id: a.id,
                    name: a.name,
                    icon: a.icon,
                  })) ?? []
                }
                selectedItem={
                  selectedA2aAgent
                    ? {
                        id: selectedA2aAgent.id,
                        name: selectedA2aAgent.name,
                        icon: selectedA2aAgent.icon,
                      }
                    : null
                }
              />
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="mx-auto w-full max-w-[1680px] space-y-8 px-6 py-6">
        {/* Hero */}
        <div className="space-y-2">
          <h1 className="max-w-3xl text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl lg:text-[40px]">
            {copy.headline}
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {copy.sub}
          </p>
        </div>

        {/* MCP flow: servers grid, client picker, instructions */}
        {gatewayType === "mcp" &&
          (selectedMcpGateway ? (
            <>
              <McpServersGrid profileId={selectedMcpGateway.id} />
              <McpClientPicker selectedId={clientId} onSelect={setClientId} />
              <McpClientInstructions
                client={selectedClient}
                profile={selectedMcpGateway}
              />
            </>
          ) : (
            <EmptyState message="No MCP Gateways available yet." />
          ))}

        {/* LLM Proxy flow */}
        {gatewayType === "proxy" &&
          (selectedLlmProxy ? (
            <LlmProxyFlow profileId={selectedLlmProxy.id} />
          ) : (
            <EmptyState message="No LLM Proxies available yet." />
          ))}

        {/* A2A flow */}
        {gatewayType === "a2a" &&
          (selectedA2aAgent ? (
            <div className="rounded-xl border bg-card p-5">
              <A2AConnectionInstructions agent={selectedA2aAgent} />
            </div>
          ) : (
            <EmptyState message="No internal agents available yet." />
          ))}
      </div>
    </div>
  );
}

interface InstanceItem {
  id: string;
  name: string;
  icon?: string | null;
}

function InstanceSelect({
  label,
  value,
  onChange,
  items,
  selectedItem,
  fallbackType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  items: InstanceItem[];
  selectedItem?: InstanceItem | null;
  fallbackType: AgentIconVariant;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="min-w-[260px] h-auto px-3 py-2.5">
        <SelectValue placeholder={`Select a ${label}`}>
          {selectedItem && (
            <div className="flex items-center gap-2.5 text-left">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
                <AgentIcon
                  icon={selectedItem.icon}
                  size={14}
                  fallbackType={fallbackType}
                />
              </span>
              <span className="truncate text-sm font-medium">
                {selectedItem.name}
              </span>
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            <div className="flex items-center gap-2.5">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
                <AgentIcon
                  icon={item.icon}
                  size={14}
                  fallbackType={fallbackType}
                />
              </span>
              <span className="text-sm font-medium">{item.name}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}
