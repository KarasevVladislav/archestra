"use client";

import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Terminal,
  Zap,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useHasPermissions } from "@/lib/auth/auth.query";
import appConfig from "@/lib/config/config";
import { useArchestraMcpIdentity } from "@/lib/mcp/archestra-mcp-server";
import {
  getStepsForAuthMode,
  type McpClientAuthMode,
  type McpClientDefinition,
} from "@/lib/mcp/mcp-clients";
import {
  useFetchTeamTokenValue,
  useTokens,
} from "@/lib/teams/team-token.query";
import { useFetchUserTokenValue, useUserToken } from "@/lib/user-token.query";
import { cn } from "@/lib/utils";

const { externalProxyUrls, internalProxyUrl } = appConfig.api;

const PERSONAL_TOKEN_ID = "__personal_token__";

interface Profile {
  id: string;
  slug?: string | null;
}

interface McpClientInstructionsProps {
  client: McpClientDefinition;
  profile: Profile | null | undefined;
}

export function McpClientInstructions({
  client,
  profile,
}: McpClientInstructionsProps) {
  const { serverName } = useArchestraMcpIdentity();
  const connectionUrl =
    externalProxyUrls.length >= 1 ? externalProxyUrls[0] : internalProxyUrl;
  const profileSlug = profile?.slug ?? profile?.id ?? "";
  const mcpUrl = `${connectionUrl}/mcp/${profileSlug}`;

  const defaultAuth: McpClientAuthMode = client.auth.oauth ? "oauth" : "token";
  const [authMode, setAuthMode] = useState<McpClientAuthMode>(defaultAuth);
  const effectiveAuth: McpClientAuthMode = client.auth[authMode]
    ? authMode
    : defaultAuth;

  const { data: canReadTeams } = useHasPermissions({ team: ["read"] });
  const { data: hasAdminPermission } = useHasPermissions({
    mcpGateway: ["admin"],
  });
  const { data: hasTeamAdminPermission } = useHasPermissions({
    mcpGateway: ["team-admin"],
  });
  const { data: userToken } = useUserToken();
  const { data: tokensData } = useTokens({
    profileId: profile?.id ?? "",
    enabled: !!canReadTeams && !!profile?.id,
  });
  const tokens = tokensData?.tokens ?? [];

  const fetchUserTokenMutation = useFetchUserTokenValue();
  const fetchTeamTokenMutation = useFetchTeamTokenValue();
  const isLoadingToken =
    fetchUserTokenMutation.isPending || fetchTeamTokenMutation.isPending;

  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [showExposedToken, setShowExposedToken] = useState(false);
  const [exposedTokenValue, setExposedTokenValue] = useState<string | null>(
    null,
  );

  const orgToken = tokens.find((t) => t.isOrganizationToken);
  const defaultTokenId = userToken
    ? PERSONAL_TOKEN_ID
    : (orgToken?.id ?? tokens[0]?.id ?? "");
  const effectiveTokenId = selectedTokenId ?? defaultTokenId;
  const isPersonalTokenSelected = effectiveTokenId === PERSONAL_TOKEN_ID;
  const selectedTeamToken = isPersonalTokenSelected
    ? null
    : tokens.find((t) => t.id === effectiveTokenId);

  const canExposeToken =
    isPersonalTokenSelected || hasAdminPermission || hasTeamAdminPermission;

  const tokenForDisplay =
    effectiveAuth === "oauth"
      ? null
      : showExposedToken && exposedTokenValue
        ? exposedTokenValue
        : isPersonalTokenSelected
          ? userToken
            ? `${userToken.tokenStart}***`
            : "ask-admin-for-access-token"
          : selectedTeamToken
            ? `${selectedTeamToken.tokenStart}***`
            : "ask-admin-for-access-token";

  const clientConfig = useMemo(() => {
    if (!client.buildConfig) return null;
    return client.buildConfig({
      mcpUrl,
      token: tokenForDisplay,
      serverName,
    });
  }, [client, mcpUrl, tokenForDisplay, serverName]);

  const fetchRealToken = useCallback(async (): Promise<string | null> => {
    if (isPersonalTokenSelected) {
      const result = await fetchUserTokenMutation.mutateAsync();
      return result?.value ?? null;
    }
    if (selectedTeamToken) {
      const result = await fetchTeamTokenMutation.mutateAsync(
        selectedTeamToken.id,
      );
      return result?.value ?? null;
    }
    return null;
  }, [
    isPersonalTokenSelected,
    selectedTeamToken,
    fetchUserTokenMutation,
    fetchTeamTokenMutation,
  ]);

  const getCodeToCopy = useCallback(async (): Promise<string> => {
    if (!clientConfig) return "";
    if (effectiveAuth !== "token" || !client.buildConfig) {
      return clientConfig.code;
    }
    const realToken = await fetchRealToken();
    if (!realToken) return clientConfig.code;
    return client.buildConfig({ mcpUrl, token: realToken, serverName }).code;
  }, [client, clientConfig, effectiveAuth, fetchRealToken, mcpUrl, serverName]);

  const handleExposeToken = useCallback(async () => {
    if (showExposedToken) {
      setShowExposedToken(false);
      setExposedTokenValue(null);
      return;
    }
    let tokenValue: string | null = null;
    if (isPersonalTokenSelected) {
      const result = await fetchUserTokenMutation.mutateAsync();
      tokenValue = result?.value ?? null;
    } else if (selectedTeamToken) {
      const result = await fetchTeamTokenMutation.mutateAsync(
        selectedTeamToken.id,
      );
      tokenValue = result?.value ?? null;
    }
    if (tokenValue) {
      setExposedTokenValue(tokenValue);
      setShowExposedToken(true);
    }
  }, [
    showExposedToken,
    isPersonalTokenSelected,
    selectedTeamToken,
    fetchUserTokenMutation,
    fetchTeamTokenMutation,
  ]);

  const resolvedSteps = getStepsForAuthMode(client, effectiveAuth);
  const hasManualSteps = resolvedSteps.length > 0;
  const showTokenSelector = effectiveAuth === "token" && tokens.length > 0;
  const quickInstallHref = client.quickInstall?.buildHref({
    mcpUrl,
    token: tokenForDisplay,
    serverName,
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border"
          style={{ background: client.tileBg ?? "hsl(var(--muted))" }}
        >
          {client.icon ?? <Terminal className="h-5 w-5" />}
        </div>
        <div className="min-w-0">
          <h3 className="text-[22px] font-bold leading-tight tracking-tight">
            Connect {client.label}
          </h3>
          {client.id === "generic" && (
            <p className="text-[13px] text-muted-foreground">
              Point any MCP-capable client at this gateway. That's it.
            </p>
          )}
        </div>
      </div>

      {/* One-click install card */}
      {client.quickInstall && quickInstallHref && (
        <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-indigo-950 to-indigo-900 p-[18px] text-white shadow-lg">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10">
            <span className="[&_svg]:fill-white [&_svg_*]:fill-white">
              {client.icon ?? <Zap className="h-5 w-5" />}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold leading-tight">
              One-click install
            </div>
            <div className="text-xs opacity-70">
              Opens {client.label} and registers the gateway.
            </div>
          </div>
          <a
            href={quickInstallHref}
            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-[13px] font-semibold text-indigo-950 shadow-sm transition-transform hover:-translate-y-px"
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.2} />
            {client.quickInstall.label}
          </a>
        </div>
      )}

      {/* Two-column body */}
      <div
        className={cn(
          "grid gap-5",
          hasManualSteps ? "md:grid-cols-[300px_1fr]" : "grid-cols-1",
        )}
      >
        {hasManualSteps && (
          <div className="rounded-xl border bg-card p-5">
            <div className="mb-3.5 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {client.quickInstall ? "Or install manually" : "Steps"}
            </div>
            <ol className="space-y-3.5">
              {resolvedSteps.map((step, i) => (
                <li key={step.title} className="flex gap-3">
                  <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-indigo-950 text-[11px] font-semibold text-white">
                    {i + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-medium leading-tight">
                      {step.title}
                    </div>
                    <div className="mt-0.5 text-[12.5px] leading-[1.5] text-muted-foreground">
                      <FormattedStepBody
                        text={
                          typeof step.body === "function"
                            ? step.body({
                                mcpUrl,
                                token: tokenForDisplay,
                                serverName,
                              })
                            : step.body
                        }
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="min-w-0 space-y-4">
          {client.auth.oauth && client.auth.token && (
            <AuthSegmented value={effectiveAuth} onChange={setAuthMode} />
          )}

          {effectiveAuth === "token" && showTokenSelector && (
            <TokenSelector
              value={effectiveTokenId}
              onChange={(v) => {
                setSelectedTokenId(v);
                setShowExposedToken(false);
                setExposedTokenValue(null);
              }}
              tokens={tokens}
              userToken={userToken}
            />
          )}

          {client.id === "generic" ? (
            <GenericFields
              mcpUrl={mcpUrl}
              authMode={effectiveAuth}
              tokenForDisplay={tokenForDisplay}
              canExposeToken={canExposeToken}
              isLoadingToken={isLoadingToken}
              showExposedToken={showExposedToken}
              onExposeToken={handleExposeToken}
            />
          ) : clientConfig ? (
            <TerminalCodeBlock
              code={clientConfig.code}
              language={clientConfig.language}
              filename={client.configFile}
              getCodeToCopy={getCodeToCopy}
            />
          ) : null}

          {effectiveAuth === "oauth" && client.id !== "generic" && (
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Your client will walk you through a browser consent.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function AuthSegmented({
  value,
  onChange,
}: {
  value: McpClientAuthMode;
  onChange: (v: McpClientAuthMode) => void;
}) {
  const tabs: Array<{
    id: McpClientAuthMode;
    label: string;
    sub: string;
  }> = [
    {
      id: "oauth",
      label: "OAuth 2.1",
      sub: "",
    },
    {
      id: "token",
      label: "Static token",
      sub: "",
    },
  ];
  return (
    <div>
      <div className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        Authentication
      </div>
      <div className="flex gap-1.5 rounded-xl border bg-muted p-1">
        {tabs.map((t) => {
          const active = value === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange(t.id)}
              className={cn(
                "flex-1 rounded-lg px-3.5 py-2.5 text-left transition-colors",
                active
                  ? "bg-card"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "text-[13px] font-semibold",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {t.label}
                </span>
              </div>
              {t.sub && (
                <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {t.sub}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FormattedStepBody({ text }: { text: string }) {
  const tokens = parseInlineMarkup(text);
  return (
    <>
      {tokens.map((tok, i) => {
        if (tok.kind === "code") {
          return (
            <code
              key={i}
              className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11.5px] text-foreground"
            >
              {tok.value}
            </code>
          );
        }
        if (tok.kind === "bold") {
          return (
            <strong key={i} className="font-semibold text-foreground">
              {tok.value}
            </strong>
          );
        }
        return <span key={i}>{tok.value}</span>;
      })}
    </>
  );
}

function parseInlineMarkup(
  text: string,
): Array<{ kind: "text" | "code" | "bold"; value: string }> {
  const out: Array<{ kind: "text" | "code" | "bold"; value: string }> = [];
  const regex = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const m of text.matchAll(regex)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: "text", value: text.slice(last, idx) });
    if (m[1] !== undefined) out.push({ kind: "code", value: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "bold", value: m[2] });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}

function TokenSelector({
  value,
  onChange,
  tokens,
  userToken,
}: {
  value: string;
  onChange: (v: string) => void;
  tokens: Array<{
    id: string;
    name: string;
    isOrganizationToken?: boolean;
    team?: { name: string } | null;
    tokenStart?: string;
  }>;
  userToken: { tokenStart?: string } | null | undefined;
}) {
  const teamTokens = tokens.filter((t) => !t.isOrganizationToken);
  const orgTokens = tokens.filter((t) => t.isOrganizationToken);
  return (
    <div>
      <div className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        Select token
      </div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-auto min-h-[52px] w-full bg-card px-3.5 py-2.5">
          <SelectValue placeholder="Select token">
            <TokenTriggerLabel
              value={value}
              userToken={userToken}
              tokens={tokens}
            />
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {userToken && (
            <SelectItem value={PERSONAL_TOKEN_ID}>
              <TokenOption
                icon={<KeyRound className="h-4 w-4" />}
                name="Personal Token"
                sub="The most secure option."
                masked={`${userToken.tokenStart}***`}
              />
            </SelectItem>
          )}
          {teamTokens.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              <TokenOption
                icon={<KeyRound className="h-4 w-4" />}
                name={t.team?.name ? `Team Token (${t.team.name})` : t.name}
                sub="To share with your teammates"
                masked={t.tokenStart ? `${t.tokenStart}***` : undefined}
              />
            </SelectItem>
          ))}
          {orgTokens.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              <TokenOption
                icon={<KeyRound className="h-4 w-4" />}
                name="Organization Token"
                sub="To share org-wide"
                masked={t.tokenStart ? `${t.tokenStart}***` : undefined}
              />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function TokenTriggerLabel({
  value,
  userToken,
  tokens,
}: {
  value: string;
  userToken: { tokenStart?: string } | null | undefined;
  tokens: Array<{
    id: string;
    name: string;
    isOrganizationToken?: boolean;
    team?: { name: string } | null;
    tokenStart?: string;
  }>;
}) {
  let name = "Select token";
  let sub = "";
  if (value === PERSONAL_TOKEN_ID && userToken) {
    name = "Personal Token";
    sub = "The most secure option.";
  } else {
    const t = tokens.find((x) => x.id === value);
    if (t) {
      name = t.isOrganizationToken
        ? "Organization Token"
        : t.team?.name
          ? `Team Token (${t.team.name})`
          : t.name;
      sub = t.isOrganizationToken
        ? "To share org-wide"
        : "To share with your teammates";
    }
  }
  return (
    <div className="flex items-center gap-2.5 text-left">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
        <KeyRound className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-semibold">{name}</div>
        {sub && (
          <div className="truncate text-[11.5px] text-muted-foreground">
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

function TokenOption({
  icon,
  name,
  sub,
  masked,
}: {
  icon: React.ReactNode;
  name: string;
  sub: string;
  masked?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold">{name}</div>
        <div className="text-[11.5px] text-muted-foreground">{sub}</div>
        {masked && (
          <div className="font-mono text-[10.5px] text-muted-foreground/70">
            {masked}
          </div>
        )}
      </div>
    </div>
  );
}

function TerminalCodeBlock({
  code,
  language,
  filename,
  getCodeToCopy,
}: {
  code: string;
  language: string;
  filename?: string;
  getCodeToCopy: () => Promise<string>;
}) {
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const onCopy = async () => {
    if (copying) return;
    setCopying(true);
    try {
      const text = await getCodeToCopy();
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Configuration copied");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Failed to copy configuration");
    } finally {
      setCopying(false);
    }
  };
  return (
    <div className="overflow-hidden rounded-xl border border-[#1f2937] bg-[#0d1117] shadow-lg">
      <div className="flex items-center gap-2.5 border-b border-[#1f2937] bg-[#111827] px-3.5 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ef4444]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#22c55e]" />
        {filename && (
          <span className="ml-1 font-mono text-[12px] text-[#9ca3af]">
            {filename}
          </span>
        )}
        <span className="rounded bg-[#1f2937] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[#9ca3af]">
          {language}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onCopy}
            disabled={copying}
            title="Copy"
            className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-[#1f2937] text-[#9ca3af] transition-colors hover:bg-[#1f2937] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : copied ? (
              <Check className="h-3.5 w-3.5 text-[#4ade80]" strokeWidth={2.5} />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
      <pre className="m-0 max-h-[360px] overflow-auto p-5 font-mono text-[13px] leading-[1.6] text-[#e5e7eb]">
        {highlight(code, language)}
      </pre>
    </div>
  );
}

function highlight(code: string, language: string): React.ReactNode {
  const lines = code.split("\n");
  return lines.map((line, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: line-numbered output
    <div key={i}>{tokenizeLine(line, language)}</div>
  ));
}

function tokenizeLine(line: string, language: string): React.ReactNode {
  if (language === "bash") {
    const m = line.match(/^(\s*)(\$)?(\s*)(.*)$/);
    if (!m) return line;
    return (
      <>
        {m[1]}
        {m[2] && <span className="text-[#6b7280]">{m[2]} </span>}
        {colorizeWords(m[4] ?? "")}
      </>
    );
  }
  return colorizeUrls(line);
}

function colorizeWords(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const tokens = text.split(/(\s+)/);
  tokens.forEach((tok, i) => {
    if (!tok) return;
    const key = `${i}-${tok.slice(0, 8)}`;
    if (/^(claude|npx|pnpm|yarn)$/.test(tok)) {
      parts.push(
        <span key={key} className="text-[#22d3ee]">
          {tok}
        </span>,
      );
    } else if (/^--?[\w-]+$/.test(tok)) {
      parts.push(
        <span key={key} className="text-[#c084fc]">
          {tok}
        </span>,
      );
    } else if (/^".*"$/.test(tok)) {
      parts.push(
        <span key={key} className="text-[#4ade80]">
          {tok}
        </span>,
      );
    } else if (/^https?:\/\//.test(tok)) {
      parts.push(
        <span key={key} className="text-[#fde047]">
          {tok}
        </span>,
      );
    } else {
      parts.push(tok);
    }
  });
  return parts;
}

function colorizeUrls(line: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const urlRe = /(https?:\/\/[^\s"']+)/g;
  const stringRe = /"([^"]*)"/g;
  const rest = line;
  let idx = 0;
  // first colorize quoted strings
  let match = stringRe.exec(rest);
  const pieces: Array<{ text: string; kind: "plain" | "str" | "url" }> = [];
  let last = 0;
  while (match) {
    if (match.index > last) {
      pieces.push({ text: rest.slice(last, match.index), kind: "plain" });
    }
    const content = match[0];
    if (/^"https?:/.test(content)) {
      pieces.push({ text: content, kind: "url" });
    } else {
      pieces.push({ text: content, kind: "str" });
    }
    last = match.index + content.length;
    match = stringRe.exec(rest);
  }
  if (last < rest.length) {
    pieces.push({ text: rest.slice(last), kind: "plain" });
  }
  pieces.forEach((p) => {
    if (p.kind === "url") {
      parts.push(
        <span key={idx++} className="text-[#fde047]">
          {p.text}
        </span>,
      );
    } else if (p.kind === "str") {
      parts.push(
        <span key={idx++} className="text-[#4ade80]">
          {p.text}
        </span>,
      );
    } else {
      // plain: still highlight bare URLs and keys
      const sub = p.text;
      const subRest = sub;
      let um = urlRe.exec(subRest);
      let subLast = 0;
      while (um) {
        if (um.index > subLast) {
          parts.push(
            <span key={idx++}>{subRest.slice(subLast, um.index)}</span>,
          );
        }
        parts.push(
          <span key={idx++} className="text-[#fde047]">
            {um[0]}
          </span>,
        );
        subLast = um.index + um[0].length;
        um = urlRe.exec(subRest);
      }
      if (subLast < subRest.length) {
        parts.push(<span key={idx++}>{subRest.slice(subLast)}</span>);
      }
    }
  });
  return parts.length ? parts : line;
}

function GenericFields({
  mcpUrl,
  authMode,
  tokenForDisplay,
  canExposeToken,
  isLoadingToken,
  showExposedToken,
  onExposeToken,
}: {
  mcpUrl: string;
  authMode: McpClientAuthMode;
  tokenForDisplay: string | null;
  canExposeToken: boolean;
  isLoadingToken: boolean;
  showExposedToken: boolean;
  onExposeToken: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <FieldRow label="MCP URL" value={mcpUrl} mono copy />
      {authMode === "token" && tokenForDisplay && (
        <FieldRow
          label="Authorization header"
          value={`Bearer ${tokenForDisplay}`}
          mono
          copy
          reveal
          revealed={showExposedToken}
          onReveal={onExposeToken}
          revealDisabled={isLoadingToken || !canExposeToken}
          isLoadingReveal={isLoadingToken}
        />
      )}
      {authMode === "oauth" && (
        <div className="border-t p-3.5 text-[12.5px] leading-[1.5] text-muted-foreground">
          Your client will walk you through a browser consent.
        </div>
      )}
    </div>
  );
}

function FieldRow({
  label,
  value,
  mono,
  copy,
  reveal,
  revealed,
  onReveal,
  revealDisabled,
  isLoadingReveal,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copy?: boolean;
  reveal?: boolean;
  revealed?: boolean;
  onReveal?: () => void;
  revealDisabled?: boolean;
  isLoadingReveal?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
      <div className="w-40 shrink-0 font-mono text-[11px] text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "min-w-0 flex-1 truncate text-[13px]",
          mono && "font-mono",
        )}
      >
        {value}
      </div>
      {reveal && (
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={onReveal}
          disabled={revealDisabled}
          title={revealed ? "Hide" : "Reveal"}
        >
          {isLoadingReveal ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : revealed ? (
            <EyeOff className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
        </Button>
      )}
      {copy && (
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            navigator.clipboard?.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
          title="Copy"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      )}
    </div>
  );
}
