import type { LucideIcon } from "lucide-react";
import { KeyRound, Lock, ShieldCheck } from "lucide-react";
import type { LlmProxyProviderDefinition } from "./llm-proxy-providers";

export type LlmProxyAuthMethodId = "direct" | "virtual" | "jwks";

export interface LlmProxyAuthMethodCredential {
  /** Header name expected upstream (e.g. `Authorization`, `x-api-key`). */
  headerName: string;
  /** Whether the value should be sent as `Bearer <value>`. */
  isBearer: boolean;
  /** Placeholder credential string to embed in snippets. */
  placeholder: string;
  /** Human-friendly label ("OpenAI API key", "Virtual API key", "JWT"). */
  label: string;
}

export interface LlmProxyAuthMethodDefinition {
  id: LlmProxyAuthMethodId;
  label: string;
  /** Short tag rendered in the code-block header. */
  short: string;
  /** Long-form description used in the bullet list. */
  description: string;
  /** Anchor under platform-llm-proxy-authentication docs. */
  docAnchor: string;
  /** Icon shown in the segmented selector. */
  icon: LucideIcon;
  /** Optional badge (e.g. "ENTERPRISE") rendered next to the tab label. */
  badge?: string;
  credential(
    provider: LlmProxyProviderDefinition,
  ): LlmProxyAuthMethodCredential;
}

export const LLM_PROXY_AUTH_METHODS: LlmProxyAuthMethodDefinition[] = [
  {
    id: "direct",
    label: "Direct Provider API Key",
    short: "Direct",
    description:
      "Send your raw provider API key. Archestra forwards it as-is. Simplest, but the real key reaches every client.",
    docAnchor: "direct-provider-api-key",
    icon: Lock,
    credential(provider) {
      const example = provider.authHeader.example;
      const isBearer = example.startsWith("Bearer ");
      return {
        headerName: provider.authHeader.name,
        isBearer,
        placeholder: `<your-${provider.tag}-api-key>`,
        label: `${provider.name} API key`,
      };
    },
  },
  {
    id: "virtual",
    label: "Virtual API Keys",
    short: "Virtual",
    description:
      "Generate an arch_… token that maps to the real provider key inside Archestra. Clients never see the upstream key. Revocable and expirable.",
    docAnchor: "virtual-api-keys",
    icon: KeyRound,
    credential() {
      return {
        headerName: "Authorization",
        isBearer: true,
        placeholder: "arch_4Kn9xQ7vJpL2sW8eRtY6uIoP3aB1cFgH",
        label: "Virtual API key",
      };
    },
  },
  {
    id: "jwks",
    label: "JWKS Authentication",
    short: "JWKS",
    description:
      "Send a JWT from your IdP (Okta, Keycloak, Auth0…). Archestra validates the signature against the JWKS endpoint and resolves the user's provider key server-side.",
    docAnchor: "jwks-external-identity-provider",
    icon: ShieldCheck,
    credential() {
      return {
        headerName: "Authorization",
        isBearer: true,
        placeholder: "$JWT",
        label: "JWT from your IdP",
      };
    },
  },
];

export function getLlmProxyAuthMethod(
  id: LlmProxyAuthMethodId,
): LlmProxyAuthMethodDefinition {
  return (
    LLM_PROXY_AUTH_METHODS.find((m) => m.id === id) ?? LLM_PROXY_AUTH_METHODS[0]
  );
}
