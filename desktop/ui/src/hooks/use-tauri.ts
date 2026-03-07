import { invoke } from "@tauri-apps/api/core";
import type {
  RuntimeInfo,
  ContainerStatus,
  ContainerConfig,
  LogEntry,
  PodInfo,
  ClusterInfo,
  UpdateInfo,
  ImageInfo,
} from "@/lib/types";

export function useTauri() {
  return {
    detectRuntime: () => invoke<RuntimeInfo>("detect_runtime"),
    startRuntime: () => invoke<RuntimeInfo>("start_runtime"),
    stopRuntime: () => invoke<void>("stop_runtime"),

    getContainerStatus: () => invoke<ContainerStatus>("get_container_status"),
    startContainer: () => invoke<ContainerStatus>("start_container"),
    stopContainer: () => invoke<void>("stop_container"),
    restartContainer: () => invoke<void>("restart_container"),
    recreateContainer: () => invoke<ContainerStatus>("recreate_container"),

    getContainerConfig: () => invoke<ContainerConfig>("get_container_config"),
    setContainerConfig: (config: ContainerConfig) =>
      invoke<void>("set_container_config", { config }),

    getContainerLogs: (
      containerName: string,
      lines: number,
      sourceFilter: string,
      levelFilter: string
    ) =>
      invoke<LogEntry[]>("get_container_logs", {
        containerName,
        lines,
        sourceFilter,
        levelFilter,
      }),

    listPods: (containerName: string) =>
      invoke<PodInfo[]>("list_pods", { containerName }),
    getPodLogs: (backendPort: number, podId: string, lines: number) =>
      invoke<LogEntry[]>("get_pod_logs", { backendPort, podId, lines }),
    describePod: (containerName: string, podName: string) =>
      invoke<string>("describe_pod", { containerName, podName }),
    restartPod: (containerName: string, podName: string) =>
      invoke<void>("restart_pod", { containerName, podName }),
    deletePod: (containerName: string, podName: string) =>
      invoke<void>("delete_pod", { containerName, podName }),
    getClusterInfo: (containerName: string) =>
      invoke<ClusterInfo>("get_cluster_info", { containerName }),

    toggleDrizzleStudio: (enable: boolean) =>
      invoke<boolean>("toggle_drizzle_studio", { enable }),
    getDrizzleStudioStatus: () => invoke<boolean>("get_drizzle_studio_status"),

    checkForUpdates: () => invoke<UpdateInfo>("check_for_updates"),
    pullLatestImage: () => invoke<void>("pull_latest_image"),
    getCurrentImageInfo: () => invoke<ImageInfo>("get_current_image_info"),
  };
}
