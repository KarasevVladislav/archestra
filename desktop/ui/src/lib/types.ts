export interface RuntimeInfo {
  runtime_type: string;
  status: string;
  version: string | null;
}

export interface ContainerStatus {
  status: string;
  image: string | null;
  uptime: string | null;
}

export interface ContainerConfig {
  image: string;
  container_name: string;
  frontend_port: number;
  backend_port: number;
  drizzle_studio_port: number;
  cpu_limit: string;
  memory_limit: string;
}

export interface LogEntry {
  timestamp: string | null;
  source: string;
  level: string;
  message: string;
}

export interface PodInfo {
  name: string;
  image: string;
  status: string;
  restarts: number;
  cpu: string | null;
  memory: string | null;
}

export interface ClusterInfo {
  cluster_name: string;
  node_count: number;
  pod_count: number;
  total_pods: number;
  cpu_usage: string | null;
  memory_usage: string | null;
}

export interface UpdateInfo {
  update_available: boolean;
  container_outdated: boolean;
  last_updated: string | null;
}

export interface ImageInfo {
  image: string;
  size: string;
  image_id: string;
}

export type Tab = "home" | "logs" | "pods" | "database" | "settings";
