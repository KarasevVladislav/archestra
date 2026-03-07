"use client";

import { useState, useEffect, useCallback } from "react";
import { useTauri } from "@/hooks/use-tauri";
import { StatusCard } from "@/components/status-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ExternalLink, Monitor, Server, Database } from "lucide-react";
import type { RuntimeInfo, ContainerStatus, ContainerConfig, ImageInfo } from "@/lib/types";

interface HomeTabProps {
  config: ContainerConfig | null;
  onUpdateAvailable: () => void;
}

const runtimeNames: Record<string, string> = {
  Colima: "Colima",
  Lima: "Lima",
  DockerDesktop: "Docker Desktop",
  Podman: "Podman",
  Wsl2: "WSL2",
  NativeDocker: "Docker (Native)",
  None: "Not Found",
};

export function HomeTab({ config, onUpdateAvailable }: HomeTabProps) {
  const api = useTauri();

  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [container, setContainer] = useState<ContainerStatus | null>(null);
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const [clusterName, setClusterName] = useState("-");
  const [clusterPods, setClusterPods] = useState("");
  const [clusterStatus, setClusterStatus] = useState("neutral");
  const [imageStatus, setImageStatus] = useState("neutral");
  const [imageSub, setImageSub] = useState("");
  const [showPullBtn, setShowPullBtn] = useState(false);
  const [runtimeLoading, setRuntimeLoading] = useState<string | null>(null);
  const [containerLoading, setContainerLoading] = useState<string | null>(null);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [pullLoading, setPullLoading] = useState(false);
  const [showRecreateBtn, setShowRecreateBtn] = useState(false);
  const [recreateLoading, setRecreateLoading] = useState(false);

  const containerRunning = container?.status === "Running";

  const refreshContainer = useCallback(async () => {
    try {
      setContainer(await api.getContainerStatus());
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      try { setRuntime(await api.detectRuntime()); } catch {}
      await refreshContainer();
      try {
        const img = await api.getCurrentImageInfo();
        setImageInfo(img);
        setImageSub(`Size: ${img.size} | ID: ${img.image_id}`);
      } catch {}
    })();
    const interval = setInterval(refreshContainer, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!containerRunning || !config) return;
    (async () => {
      try {
        const cluster = await api.getClusterInfo(config.container_name);
        setClusterName(cluster.cluster_name);
        setClusterPods(`${cluster.pod_count}/${cluster.total_pods} pods running`);
        setClusterStatus(cluster.pod_count > 0 ? "running" : "neutral");
      } catch {}
    })();
  }, [containerRunning, config]);

  function formatUptime(uptime: string | null): string {
    if (!uptime) return "";
    const diff = Date.now() - new Date(uptime).getTime();
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    return hours > 0 ? `Up ${hours}h ${minutes}m` : `Up ${minutes}m`;
  }

  async function handleStartRuntime() {
    setRuntimeLoading("Starting...");
    try { setRuntime(await api.startRuntime()); await refreshContainer(); }
    catch (e) { alert("Failed to start runtime: " + e); }
    setRuntimeLoading(null);
  }

  async function handleStopRuntime() {
    setRuntimeLoading("Stopping...");
    try { await api.stopRuntime(); setRuntime(await api.detectRuntime()); }
    catch (e) { alert("Failed to stop runtime: " + e); }
    setRuntimeLoading(null);
  }

  async function handleStartContainer() {
    setContainerLoading("Starting...");
    try { setContainer(await api.startContainer()); }
    catch (e) { alert("Failed to start container: " + e); }
    setContainerLoading(null);
  }

  async function handleStopContainer() {
    setContainerLoading("Stopping...");
    try { await api.stopContainer(); await refreshContainer(); }
    catch (e) { alert("Failed to stop container: " + e); }
    setContainerLoading(null);
  }

  async function handleRestartContainer() {
    setContainerLoading("Restarting...");
    try { await api.restartContainer(); await refreshContainer(); }
    catch (e) { alert("Failed to restart container: " + e); }
    setContainerLoading(null);
  }

  async function handleCheckUpdates() {
    setUpdateLoading(true);
    try {
      const info = await api.checkForUpdates();
      if (info.update_available) {
        setImageStatus("starting");
        setShowPullBtn(true);
        setShowRecreateBtn(false);
        setImageSub(`Update available! Last updated: ${info.last_updated || "unknown"}`);
        onUpdateAvailable();
      } else if (info.container_outdated) {
        setImageStatus("starting");
        setShowPullBtn(false);
        setShowRecreateBtn(true);
        setImageSub("Image is up to date, but container needs to be recreated");
      } else {
        setImageStatus("running");
        setShowPullBtn(false);
        setShowRecreateBtn(false);
        setImageSub("Up to date");
      }
    } catch (e) { alert("Failed to check updates: " + e); }
    setUpdateLoading(false);
  }

  async function handlePullImage() {
    setPullLoading(true);
    try {
      await api.pullLatestImage();
      setImageStatus("running");
      setShowPullBtn(false);
      setShowRecreateBtn(false);
      const img = await api.getCurrentImageInfo();
      setImageInfo(img);
      setImageSub(`Size: ${img.size} | ID: ${img.image_id}`);
      // Recreate container from the new image
      setContainerLoading("Recreating...");
      await api.recreateContainer();
      await refreshContainer();
      setContainerLoading(null);
    } catch (e) { alert("Failed to pull/update: " + e); }
    setPullLoading(false);
  }

  async function handleRecreateContainer() {
    setRecreateLoading(true);
    try {
      await api.recreateContainer();
      await refreshContainer();
      setShowRecreateBtn(false);
      setImageStatus("running");
      setImageSub("Up to date");
    } catch (e) { alert("Failed to recreate container: " + e); }
    setRecreateLoading(false);
  }

  async function openUrl(port: number) {
    if (!containerRunning) return;
    await openFullUrl(`http://localhost:${port}`);
  }

  async function openFullUrl(url: string) {
    if (!containerRunning) return;
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } catch {
      window.open(url, "_blank");
    }
  }

  const fp = config?.frontend_port || 3000;
  const bp = config?.backend_port || 9000;
  const dp = config?.drizzle_studio_port || 4983;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Dashboard</h2>
        <Button disabled={!containerRunning} onClick={() => openUrl(fp)}>
          <ExternalLink className="h-4 w-4" />
          Open Archestra UI
        </Button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        <StatusCard
          title="Runtime"
          status={runtime?.status || "stopped"}
          value={runtimeNames[runtime?.runtime_type || "None"] || "Detecting..."}
          sub={runtime?.version || ""}
        >
          <Button size="sm" variant="outline" disabled={runtime?.status === "Running" || runtime?.runtime_type === "None" || !!runtimeLoading} onClick={handleStartRuntime}>
            {runtimeLoading === "Starting..." ? "Starting..." : "Start"}
          </Button>
          <Button size="sm" variant="destructive" disabled={runtime?.status !== "Running" || runtime?.runtime_type === "NativeDocker" || !!runtimeLoading} onClick={handleStopRuntime}>
            {runtimeLoading === "Stopping..." ? "Stopping..." : "Stop"}
          </Button>
        </StatusCard>

        <StatusCard
          title="Container"
          status={container?.status || "stopped"}
          value={container?.image || "-"}
          sub={formatUptime(container?.uptime || null)}
        >
          <Button size="sm" disabled={containerRunning || !!containerLoading} onClick={handleStartContainer}>
            {containerLoading === "Starting..." ? "Starting..." : "Start"}
          </Button>
          <Button size="sm" variant="destructive" disabled={!containerRunning || !!containerLoading} onClick={handleStopContainer}>
            {containerLoading === "Stopping..." ? "Stopping..." : "Stop"}
          </Button>
          <Button size="sm" variant="outline" disabled={!containerRunning || !!containerLoading} onClick={handleRestartContainer}>
            {containerLoading === "Restarting..." ? "Restarting..." : "Restart"}
          </Button>
        </StatusCard>

        <StatusCard title="Image" status={imageStatus} value={imageInfo?.image || "-"} sub={imageSub}>
          <Button size="sm" variant="outline" disabled={updateLoading} onClick={handleCheckUpdates}>
            {updateLoading ? "Checking..." : "Check for Updates"}
          </Button>
          {showPullBtn && (
            <Button size="sm" disabled={pullLoading} onClick={handlePullImage}>
              {pullLoading ? "Pulling..." : "Pull Update"}
            </Button>
          )}
          {showRecreateBtn && (
            <Button size="sm" disabled={recreateLoading} onClick={handleRecreateContainer}>
              {recreateLoading ? "Recreating..." : "Recreate Container"}
            </Button>
          )}
        </StatusCard>

        <StatusCard title="Cluster" status={clusterStatus} value={clusterName} sub={clusterPods} />
      </div>

      {/* Quick Links */}
      <div>
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground">Quick Links</h3>
        <div className="flex gap-3 flex-wrap">
          {[
            { label: "Frontend", port: fp, url: `http://localhost:${fp}`, icon: Monitor },
            { label: "Backend API", port: bp, url: `http://localhost:${bp}`, icon: Server },
            { label: "Drizzle Studio", port: dp, url: `https://local.drizzle.studio?port=${dp}`, icon: Database },
          ].map((link) => {
            const Icon = link.icon;
            return (
              <Card
                key={link.label}
                onClick={() => openFullUrl(link.url)}
                className={`flex flex-row items-center gap-2.5 px-4 py-3 cursor-pointer transition-colors ${
                  containerRunning ? "hover:border-primary hover:bg-accent" : "opacity-40 cursor-not-allowed"
                }`}
              >
                <Icon className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm">{link.label}</span>
                <span className="font-mono text-xs text-muted-foreground">:{link.port}</span>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
