use serde::{Deserialize, Serialize};
use tokio::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct PodInfo {
    pub name: String,
    pub status: String,
    pub restarts: String,
    pub age: String,
    pub image: String,
    pub cpu: Option<String>,
    pub memory: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ClusterInfo {
    pub node_count: u32,
    pub pod_count: u32,
    pub total_pods: u32,
    pub cpu_usage: Option<String>,
    pub memory_usage: Option<String>,
    pub cluster_name: String,
}

async fn kubectl_in_container(container_name: &str, args: &[&str]) -> Result<String, String> {
    // kubectl lives in the KinD control plane container, not the main archestra container
    let control_plane = format!("{}-mcp-control-plane", container_name);
    let kubectl_args: Vec<String> = std::iter::once("exec".to_string())
        .chain(std::iter::once(control_plane))
        .chain(std::iter::once("kubectl".to_string()))
        .chain(args.iter().map(|s| s.to_string()))
        .collect();

    let str_args: Vec<&str> = kubectl_args.iter().map(|s| s.as_str()).collect();

    let output = Command::new("docker")
        .args(&str_args)
        .output()
        .await
        .map_err(|e| format!("Failed to execute kubectl: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Ok(String::new())
        } else {
            Err(stderr)
        }
    }
}

/// List all MCP server pods in the KinD cluster.
#[tauri::command]
pub async fn list_pods(container_name: String) -> Result<Vec<PodInfo>, String> {
    let output = kubectl_in_container(
        &container_name,
        &[
            "get",
            "pods",
            "-n",
            "default",
            "-o",
            "jsonpath={range .items[*]}{.metadata.name}|{.status.phase}|{.status.containerStatuses[0].restartCount}|{.metadata.creationTimestamp}|{.spec.containers[0].image}{\"\\n\"}{end}",
        ],
    )
    .await?;

    let pods: Vec<PodInfo> = output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.split('|').collect();
            PodInfo {
                name: parts.first().unwrap_or(&"unknown").to_string(),
                status: parts.get(1).unwrap_or(&"Unknown").to_string(),
                restarts: parts.get(2).unwrap_or(&"0").to_string(),
                age: parts.get(3).unwrap_or(&"").to_string(),
                image: parts.get(4).unwrap_or(&"unknown").to_string(),
                cpu: None,
                memory: None,
            }
        })
        .collect();

    // Try to get resource usage (may fail if metrics-server isn't installed)
    if let Ok(top_output) =
        kubectl_in_container(&container_name, &["top", "pods", "--no-headers"]).await
    {
        let mut pods = pods;
        for line in top_output.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 {
                let pod_name = parts[0];
                if let Some(pod) = pods.iter_mut().find(|p| p.name == pod_name) {
                    pod.cpu = Some(parts[1].to_string());
                    pod.memory = Some(parts[2].to_string());
                }
            }
        }
        return Ok(pods);
    }

    Ok(pods)
}

/// Restart a specific pod by deleting it (deployment will recreate it).
#[tauri::command]
pub async fn restart_pod(container_name: String, pod_name: String) -> Result<String, String> {
    kubectl_in_container(&container_name, &["delete", "pod", &pod_name]).await
}

/// Delete a pod's deployment entirely.
#[tauri::command]
pub async fn delete_pod(container_name: String, pod_name: String) -> Result<String, String> {
    // Extract deployment name from pod name (remove the hash suffix)
    let deployment_name = pod_name
        .rsplitn(3, '-')
        .skip(2)
        .collect::<Vec<&str>>()
        .into_iter()
        .rev()
        .collect::<Vec<&str>>()
        .join("-");

    if deployment_name.is_empty() {
        // If we can't determine deployment name, just delete the pod
        kubectl_in_container(&container_name, &["delete", "pod", &pod_name]).await
    } else {
        kubectl_in_container(&container_name, &["delete", "deployment", &deployment_name]).await
    }
}

/// Get detailed information about a specific pod.
#[tauri::command]
pub async fn describe_pod(container_name: String, pod_name: String) -> Result<String, String> {
    kubectl_in_container(&container_name, &["describe", "pod", &pod_name]).await
}

/// Get cluster-level information.
#[tauri::command]
pub async fn get_cluster_info(container_name: String) -> Result<ClusterInfo, String> {
    let nodes_output =
        kubectl_in_container(&container_name, &["get", "nodes", "--no-headers"]).await;
    let node_count = nodes_output
        .as_ref()
        .map(|o| o.lines().count() as u32)
        .unwrap_or(0);

    let pods_output =
        kubectl_in_container(&container_name, &["get", "pods", "--no-headers", "-A"]).await;
    let total_pods = pods_output
        .as_ref()
        .map(|o| o.lines().count() as u32)
        .unwrap_or(0);
    let running_pods = pods_output
        .as_ref()
        .map(|o| {
            o.lines()
                .filter(|l| l.contains("Running"))
                .count() as u32
        })
        .unwrap_or(0);

    let cluster_name = kubectl_in_container(
        &container_name,
        &["config", "current-context"],
    )
    .await
    .unwrap_or_else(|_| "kind-archestra".to_string());

    // Try to get node resource usage
    let (cpu_usage, memory_usage) =
        if let Ok(top) = kubectl_in_container(&container_name, &["top", "node", "--no-headers"]).await
        {
            let parts: Vec<&str> = top.split_whitespace().collect();
            (
                parts.get(1).map(|s| s.to_string()),
                parts.get(3).map(|s| s.to_string()),
            )
        } else {
            (None, None)
        };

    Ok(ClusterInfo {
        node_count,
        pod_count: running_pods,
        total_pods,
        cpu_usage,
        memory_usage,
        cluster_name,
    })
}
