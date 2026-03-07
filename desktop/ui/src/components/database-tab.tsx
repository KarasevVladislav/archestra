"use client";

import { useState, useEffect } from "react";
import { useTauri } from "@/hooks/use-tauri";
import { StatusCard } from "@/components/status-card";
import { Button } from "@/components/ui/button";
import type { ContainerConfig } from "@/lib/types";

interface DatabaseTabProps {
  config: ContainerConfig | null;
  containerRunning: boolean;
}

export function DatabaseTab({ config, containerRunning }: DatabaseTabProps) {
  const api = useTauri();
  const [drizzleRunning, setDrizzleRunning] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try { setDrizzleRunning(await api.getDrizzleStudioStatus()); } catch {}
    })();
  }, []);

  async function handleToggle() {
    setLoading(true);
    try { setDrizzleRunning(await api.toggleDrizzleStudio(!drizzleRunning)); }
    catch (e) { alert("Failed to toggle Drizzle Studio: " + e); }
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Database</h2>
      <div className="max-w-[600px]">
        <StatusCard
          title="Drizzle Studio"
          status={drizzleRunning ? "running" : "stopped"}
          value={drizzleRunning ? "Running" : "Stopped"}
          description="Drizzle Studio provides a visual interface for browsing and managing the Archestra PostgreSQL database. It runs inside the container and is accessible via your browser."
          warning="Warning: Drizzle Studio gives full read/write access to the database. Use with caution."
        >
          <Button
            variant={drizzleRunning ? "destructive" : "default"}
            disabled={loading || !containerRunning}
            onClick={handleToggle}
          >
            {loading
              ? drizzleRunning ? "Disabling..." : "Enabling..."
              : drizzleRunning ? "Disable Drizzle Studio" : "Enable Drizzle Studio"}
          </Button>
          {drizzleRunning && (
            <Button variant="outline" size="sm" onClick={async () => {
              const url = `https://local.drizzle.studio?port=${config?.drizzle_studio_port || 4983}`;
              try {
                const { open } = await import("@tauri-apps/plugin-shell");
                await open(url);
              } catch {
                window.open(url, "_blank");
              }
            }}>
              Open in Browser
            </Button>
          )}
        </StatusCard>
      </div>
    </div>
  );
}
