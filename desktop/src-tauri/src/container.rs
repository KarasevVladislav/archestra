use crate::state::{AppState, ContainerConfig, ContainerStatus};
use serde::Serialize;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::Mutex;

#[derive(Debug, Serialize)]
pub struct ContainerInfo {
    pub status: ContainerStatus,
    pub image: String,
    pub uptime: Option<String>,
    pub ports: Vec<String>,
}

async fn docker_exec(args: &[&str]) -> Result<String, String> {
    let output = Command::new("docker")
        .args(args)
        .output()
        .await
        .map_err(|e| format!("Failed to execute docker command: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// Get the current Archestra container status.
#[tauri::command]
pub async fn get_container_status(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<ContainerInfo, String> {
    let state = state.lock().await;
    let name = &state.container_config.container_name;

    let inspect = docker_exec(&[
        "inspect",
        "--format",
        "{{.State.Status}}|{{.State.StartedAt}}|{{.Config.Image}}",
        name,
    ])
    .await;

    match inspect {
        Ok(output) => {
            let parts: Vec<&str> = output.split('|').collect();
            let status_str = parts.first().unwrap_or(&"unknown");
            let started_at = parts.get(1).unwrap_or(&"").to_string();
            let image = parts.get(2).unwrap_or(&"unknown").to_string();

            let status = match *status_str {
                "running" => ContainerStatus::Running,
                "exited" | "dead" => ContainerStatus::Stopped,
                "created" | "restarting" => ContainerStatus::Starting,
                _ => ContainerStatus::Error,
            };

            let ports_output = docker_exec(&[
                "port",
                name,
            ])
            .await
            .unwrap_or_default();
            let ports: Vec<String> = ports_output
                .lines()
                .map(|l| l.to_string())
                .collect();

            Ok(ContainerInfo {
                status,
                image,
                uptime: if started_at.is_empty() {
                    None
                } else {
                    Some(started_at)
                },
                ports,
            })
        }
        Err(_) => Ok(ContainerInfo {
            status: ContainerStatus::NotFound,
            image: state.container_config.image.clone(),
            uptime: None,
            ports: vec![],
        }),
    }
}

/// Start the Archestra container with the configured settings.
#[tauri::command]
pub async fn start_container(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<ContainerInfo, String> {
    let mut state = state.lock().await;
    let config = state.container_config.clone();

    // Check if container already exists but is stopped
    let existing = docker_exec(&[
        "inspect",
        "--format",
        "{{.State.Status}}",
        &config.container_name,
    ])
    .await;

    if let Ok(status) = existing {
        if status == "exited" || status == "created" {
            // Start existing container
            docker_exec(&["start", &config.container_name]).await?;
            state.container_status = ContainerStatus::Running;
            return Ok(ContainerInfo {
                status: ContainerStatus::Running,
                image: config.image,
                uptime: None,
                ports: vec![],
            });
        }
        if status == "running" {
            state.container_status = ContainerStatus::Running;
            return Ok(ContainerInfo {
                status: ContainerStatus::Running,
                image: config.image,
                uptime: None,
                ports: vec![],
            });
        }
    }

    state.container_status = ContainerStatus::Starting;

    // Run new container
    let result = docker_exec(&[
        "run",
        "-d",
        "--name",
        &config.container_name,
        "--restart",
        "unless-stopped",
        "-p",
        &format!("{}:9000", config.backend_port),
        "-p",
        &format!("{}:3000", config.frontend_port),
        "-p",
        &format!("{}:4983", config.drizzle_studio_port),
        "-e",
        "ARCHESTRA_QUICKSTART=true",
        "-v",
        "/var/run/docker.sock:/var/run/docker.sock",
        "-v",
        "archestra-postgres-data:/var/lib/postgresql/data",
        "-v",
        "archestra-app-data:/app/data",
        &config.image,
    ])
    .await;

    match result {
        Ok(_) => {
            state.container_status = ContainerStatus::Running;
            Ok(ContainerInfo {
                status: ContainerStatus::Running,
                image: config.image,
                uptime: None,
                ports: vec![
                    format!("{}:3000 (Frontend)", config.frontend_port),
                    format!("{}:9000 (Backend)", config.backend_port),
                ],
            })
        }
        Err(e) => {
            state.container_status = ContainerStatus::Error;
            Err(format!("Failed to start container: {}", e))
        }
    }
}

/// Stop the Archestra container.
#[tauri::command]
pub async fn stop_container(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<(), String> {
    let mut state = state.lock().await;
    let name = state.container_config.container_name.clone();

    state.container_status = ContainerStatus::Stopping;
    docker_exec(&["stop", &name]).await?;
    state.container_status = ContainerStatus::Stopped;
    Ok(())
}

/// Restart the Archestra container.
#[tauri::command]
pub async fn restart_container(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<(), String> {
    let mut state = state.lock().await;
    let name = state.container_config.container_name.clone();

    state.container_status = ContainerStatus::Starting;
    docker_exec(&["restart", &name]).await?;
    state.container_status = ContainerStatus::Running;
    Ok(())
}

/// Recreate the container from the current image (used after pulling an update).
/// Stops and removes the old container, then creates a new one with the same config.
#[tauri::command]
pub async fn recreate_container(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<ContainerInfo, String> {
    let mut state = state.lock().await;
    let config = state.container_config.clone();

    state.container_status = ContainerStatus::Starting;

    // Stop if running
    let _ = docker_exec(&["stop", &config.container_name]).await;
    // Remove old container
    let _ = docker_exec(&["rm", &config.container_name]).await;

    // Create new container from (potentially updated) image
    let result = docker_exec(&[
        "run",
        "-d",
        "--name",
        &config.container_name,
        "--restart",
        "unless-stopped",
        "-p",
        &format!("{}:9000", config.backend_port),
        "-p",
        &format!("{}:3000", config.frontend_port),
        "-p",
        &format!("{}:4983", config.drizzle_studio_port),
        "-e",
        "ARCHESTRA_QUICKSTART=true",
        "-v",
        "/var/run/docker.sock:/var/run/docker.sock",
        "-v",
        "archestra-postgres-data:/var/lib/postgresql/data",
        "-v",
        "archestra-app-data:/app/data",
        &config.image,
    ])
    .await;

    match result {
        Ok(_) => {
            state.container_status = ContainerStatus::Running;
            Ok(ContainerInfo {
                status: ContainerStatus::Running,
                image: config.image,
                uptime: None,
                ports: vec![
                    format!("{}:3000 (Frontend)", config.frontend_port),
                    format!("{}:9000 (Backend)", config.backend_port),
                ],
            })
        }
        Err(e) => {
            state.container_status = ContainerStatus::Error;
            Err(format!("Failed to recreate container: {}", e))
        }
    }
}

/// Get the current container configuration.
#[tauri::command]
pub async fn get_container_config(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<ContainerConfig, String> {
    let state = state.lock().await;
    Ok(state.container_config.clone())
}

/// Update the container configuration. Requires container restart to take effect.
#[tauri::command]
pub async fn set_container_config(
    config: ContainerConfig,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<(), String> {
    let mut state = state.lock().await;
    state.container_config = config;
    state.save_config()
}

/// Start or stop Drizzle Studio inside the running container.
#[tauri::command]
pub async fn toggle_drizzle_studio(
    enable: bool,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<bool, String> {
    let mut state = state.lock().await;
    let name = &state.container_config.container_name;

    if enable {
        // Start drizzle-kit studio inside the container
        // DATABASE_URL is needed because docker exec doesn't inherit supervisor env
        // Create a minimal drizzle config (production image doesn't have schema source files)
        // and extract DATABASE_URL from the running backend process
        docker_exec(&[
            "exec",
            "-d",
            name,
            "sh",
            "-c",
            concat!(
                "export DATABASE_URL=$(cat /proc/$(pgrep -f 'node dist/server' | head -1)/environ 2>/dev/null | tr '\\0' '\\n' | grep ^DATABASE_URL= | cut -d= -f2-) && ",
                "printf 'import{defineConfig}from\"drizzle-kit\";export default defineConfig({dialect:\"postgresql\",dbCredentials:{url:process.env.DATABASE_URL!}});' > /tmp/drizzle-studio.config.ts && ",
                "/app/backend/node_modules/.bin/drizzle-kit studio --config /tmp/drizzle-studio.config.ts --host 0.0.0.0 --port 4983"
            ),
        ])
        .await?;
        state.drizzle_studio_running = true;
    } else {
        // Kill drizzle-kit studio process
        let _ = docker_exec(&[
            "exec",
            name,
            "sh",
            "-c",
            "pkill -f 'drizzle-kit studio' || true",
        ])
        .await;
        state.drizzle_studio_running = false;
    }

    Ok(state.drizzle_studio_running)
}

/// Check if Drizzle Studio is currently running.
#[tauri::command]
pub async fn get_drizzle_studio_status(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<bool, String> {
    let state = state.lock().await;
    Ok(state.drizzle_studio_running)
}
