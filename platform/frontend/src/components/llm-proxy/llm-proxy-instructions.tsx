"use client";

import { ArrowRight, Check, Copy, Terminal, TriangleAlert } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { ExternalDocsLink } from "@/components/external-docs-link";
import { Button } from "@/components/ui/button";
import { getFrontendDocsUrl } from "@/lib/docs/docs";
import {
  getLlmProxyAuthMethod,
  LLM_PROXY_AUTH_METHODS,
  type LlmProxyAuthMethodId,
} from "@/lib/llm-proxy/llm-proxy-auth-methods";
import type { LlmProxyClientDefinition } from "@/lib/llm-proxy/llm-proxy-clients";
import {
  buildLlmProxyUrl,
  type LlmProxyProviderDefinition,
} from "@/lib/llm-proxy/llm-proxy-providers";
import { cn } from "@/lib/utils";

interface LlmProxyInstructionsProps {
  provider: LlmProxyProviderDefinition;
  client: LlmProxyClientDefinition;
  connectionBase: string;
  profileId?: string | null;
}

export function LlmProxyInstructions({
  provider,
  client,
  connectionBase,
  profileId,
}: LlmProxyInstructionsProps) {
  const proxyUrl = useMemo(
    () => buildLlmProxyUrl(provider, connectionBase, profileId),
    [provider, connectionBase, profileId],
  );

  const [authMethodId, setAuthMethodId] =
    useState<LlmProxyAuthMethodId>("direct");
  const authMethod = getLlmProxyAuthMethod(authMethodId);
  const credential = authMethod.credential(provider);

  const snippet = useMemo(
    () =>
      client.buildSnippet({
        provider,
        proxyUrl,
        credentialPlaceholder: credential.placeholder,
        credentialLabel: credential.label,
        authHeaderName: credential.headerName,
        authHeaderIsBearer: credential.isBearer,
      }),
    [client, provider, proxyUrl, credential],
  );

  return (
    <div className="space-y-4">
      <Header provider={provider} client={client} />

      <UrlSwapCard provider={provider} client={client} proxyUrl={proxyUrl} />

      <AuthSummaryCard />

      <AuthMethodSegmented value={authMethodId} onChange={setAuthMethodId} />

      <CodeBlock
        client={client}
        provider={provider}
        authMethodShort={authMethod.short}
        language={snippet.language}
        code={snippet.code}
        copyDisabled={snippet.unsupported}
      />

      {snippet.note && <NoteCallout text={snippet.note} />}
    </div>
  );
}

function Header({
  provider,
  client,
}: {
  provider: LlmProxyProviderDefinition;
  client: LlmProxyClientDefinition;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border"
        style={{ background: client.tileBg ?? "hsl(var(--muted))" }}
      >
        {client.icon ?? <Terminal className="h-5 w-5" />}
      </div>
      <div className="min-w-0">
        <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          Routing {provider.name} through Archestra
        </div>
        <h3 className="text-[20px] font-bold leading-tight tracking-tight">
          Configure {client.label}
        </h3>
      </div>
    </div>
  );
}

function UrlSwapCard({
  provider,
  client,
  proxyUrl,
}: {
  provider: LlmProxyProviderDefinition;
  client: LlmProxyClientDefinition;
  proxyUrl: string;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(proxyUrl);
      setCopied(true);
      toast.success("Proxy URL copied to clipboard");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Failed to copy");
    }
  };
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="mb-3 text-sm text-muted-foreground">
        Replace your{" "}
        <span className="font-medium text-foreground">{provider.name}</span>{" "}
        base URL in {client.label}:
      </p>
      <div className="grid items-center gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 px-3 py-2">
          <div className="truncate font-mono text-xs text-muted-foreground line-through">
            {provider.originalUrl || "(no default URL)"}
          </div>
        </div>
        <div className="flex justify-center text-muted-foreground">
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="flex items-center gap-2 overflow-hidden rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-primary">
            {proxyUrl}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-primary hover:bg-primary/10 hover:text-primary"
            onClick={onCopy}
            title="Copy"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AuthSummaryCard() {
  const docsBase = getFrontendDocsUrl("platform-llm-proxy-authentication");
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-1 text-sm font-semibold tracking-tight">
        Authentication
      </div>
      <p className="mb-3 text-[12.5px] leading-relaxed text-muted-foreground">
        Choose the authentication method that fits your client and deployment
        model.
      </p>
      <ul className="space-y-2 text-[13px] text-muted-foreground">
        {LLM_PROXY_AUTH_METHODS.map((m) => (
          <li key={m.id} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground"
            />
            <span>
              {docsBase ? (
                <ExternalDocsLink
                  href={`${docsBase}#${m.docAnchor}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                  showIcon={false}
                >
                  {m.label}
                </ExternalDocsLink>
              ) : (
                <span className="font-medium text-foreground">{m.label}</span>
              )}
              {" — "}
              {m.description}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AuthMethodSegmented({
  value,
  onChange,
}: {
  value: LlmProxyAuthMethodId;
  onChange: (v: LlmProxyAuthMethodId) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        Snippet uses
      </div>
      <div
        role="tablist"
        className="flex flex-wrap gap-1 rounded-xl border bg-card p-1.5"
      >
        {LLM_PROXY_AUTH_METHODS.map((m) => {
          const active = value === m.id;
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(m.id)}
              className={cn(
                "flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                  active ? "bg-white/15 text-white" : "bg-primary/10 text-primary",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">{m.label}</span>
                {m.badge && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider",
                      active
                        ? "bg-white/15 text-white"
                        : "bg-primary/10 text-primary",
                    )}
                  >
                    {m.badge}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CodeBlock({
  client,
  provider,
  authMethodShort,
  language,
  code,
  copyDisabled,
}: {
  client: LlmProxyClientDefinition;
  provider: LlmProxyProviderDefinition;
  authMethodShort: string;
  language: string;
  code: string;
  copyDisabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Snippet copied");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Failed to copy");
    }
  }, [code]);

  return (
    <div className="overflow-hidden rounded-xl border border-[#1f2937] bg-[#0d1117] shadow-lg">
      <div className="flex items-center gap-2.5 border-b border-[#1f2937] bg-[#111827] px-3.5 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ef4444]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#22c55e]" />
        <span className="ml-1 truncate font-mono text-[11px] uppercase tracking-wider text-[#9ca3af]">
          {client.label} · {provider.name} · {authMethodShort}
        </span>
        <span className="rounded bg-[#1f2937] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[#9ca3af]">
          {language}
        </span>
        {!copyDisabled && (
          <button
            type="button"
            onClick={onCopy}
            title="Copy"
            className="ml-auto inline-flex h-[26px] items-center gap-1.5 rounded-md border border-[#1f2937] px-2 text-[11px] text-[#9ca3af] transition-colors hover:bg-[#1f2937] hover:text-white"
          >
            {copied ? (
              <>
                <Check
                  className="h-3.5 w-3.5 text-[#4ade80]"
                  strokeWidth={2.5}
                />
                copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                copy
              </>
            )}
          </button>
        )}
      </div>
      <pre className="m-0 max-h-[420px] overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-[12.5px] leading-[1.6] text-[#e5e7eb]">
        {code}
      </pre>
    </div>
  );
}

function NoteCallout({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
