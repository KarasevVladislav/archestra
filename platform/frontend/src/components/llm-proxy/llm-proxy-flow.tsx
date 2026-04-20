"use client";

import { useEffect, useState } from "react";
import { ConnectionBaseUrlSelect } from "@/components/connection-base-url-select";
import { LlmProxyClientPicker } from "@/components/llm-proxy/llm-proxy-client-picker";
import { LlmProxyInstructions } from "@/components/llm-proxy/llm-proxy-instructions";
import { LlmProxyProviderPicker } from "@/components/llm-proxy/llm-proxy-provider-picker";
import appConfig from "@/lib/config/config";
import {
  getLlmProxyClient,
  LLM_PROXY_CLIENTS,
} from "@/lib/llm-proxy/llm-proxy-clients";
import {
  getLlmProxyProvider,
  type LlmProxyProviderDefinition,
} from "@/lib/llm-proxy/llm-proxy-providers";

const { externalProxyUrls, internalProxyUrl } = appConfig.api;
const DEFAULT_CONNECTION_BASE =
  externalProxyUrls.length >= 1 ? externalProxyUrls[0] : internalProxyUrl;

interface LlmProxyFlowProps {
  profileId?: string | null;
}

export function LlmProxyFlow({ profileId }: LlmProxyFlowProps) {
  const [providerId, setProviderId] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(
    LLM_PROXY_CLIENTS[0].id,
  );
  const [connectionBase, setConnectionBase] = useState<string>(
    DEFAULT_CONNECTION_BASE,
  );

  const provider: LlmProxyProviderDefinition | null = providerId
    ? (getLlmProxyProvider(providerId) ?? null)
    : null;
  const client = clientId ? (getLlmProxyClient(clientId) ?? null) : null;

  // If the chosen provider is not compatible with the current client, drop to generic.
  useEffect(() => {
    if (!provider || !clientId) return;
    const c = getLlmProxyClient(clientId);
    if (!c || !c.supports.includes(provider.wire)) {
      setClientId("generic");
    }
  }, [provider, clientId]);

  const showInstructions = provider && client;

  return (
    <div className="space-y-6">
      {externalProxyUrls.length > 1 && (
        <ConnectionBaseUrlSelect
          value={connectionBase}
          onChange={setConnectionBase}
          idPrefix="llm-proxy"
        />
      )}

      <LlmProxyProviderPicker
        selectedId={providerId}
        onSelect={(p) => setProviderId(p.id)}
      />

      <LlmProxyClientPicker
        selectedId={clientId}
        onSelect={setClientId}
        provider={provider}
        disabled={!provider}
      />

      {showInstructions ? (
        <div className="rounded-xl border bg-card p-5">
          <LlmProxyInstructions
            provider={provider}
            client={client}
            connectionBase={connectionBase}
            profileId={profileId}
          />
        </div>
      ) : (
        <EmptyHint
          text={
            !provider
              ? "Pick a provider above to continue."
              : "Now pick the client you want to route through Archestra."
          }
        />
      )}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div
      className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground"
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, hsl(var(--muted) / 0.4) 0 12px, hsl(var(--background)) 12px 24px)",
      }}
    >
      {text}
    </div>
  );
}
