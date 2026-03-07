use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::Mutex;

#[derive(Debug, Serialize)]
pub struct UpdateInfo {
    pub update_available: bool,
    pub container_outdated: bool,
    pub current_digest: Option<String>,
    pub remote_digest: Option<String>,
    pub current_image: String,
    pub last_updated: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ImageInfo {
    pub image: String,
    pub image_id: String,
    pub created: String,
    pub size: String,
}

#[derive(Debug, Deserialize)]
struct DockerHubTag {
    last_updated: Option<String>,
    digest: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DockerHubResponse {
    results: Option<Vec<DockerHubTag>>,
}

/// Check Docker Hub for a newer version of the Archestra image.
#[tauri::command]
pub async fn check_for_updates(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<UpdateInfo, String> {
    let state = state.lock().await;
    let image = &state.container_config.image;

    // Parse image name and tag
    let (repo, tag) = if let Some(pos) = image.rfind(':') {
        (&image[..pos], &image[pos + 1..])
    } else {
        (image.as_str(), "latest")
    };

    // Get local image digest
    let local_digest = Command::new("docker")
        .args(["inspect", "--format", "{{.RepoDigests}}", image])
        .output()
        .await
        .ok()
        .and_then(|o| {
            if o.status.success() {
                let output = String::from_utf8_lossy(&o.stdout).trim().to_string();
                // Extract digest from [repo@sha256:abc...] format
                output
                    .split("sha256:")
                    .nth(1)
                    .map(|s| s.trim_end_matches(']').to_string())
            } else {
                None
            }
        });

    // Check Docker Hub for the latest digest
    let hub_url = format!(
        "https://hub.docker.com/v2/repositories/{}/tags/{}",
        repo, tag
    );
    let remote_response = reqwest::get(&hub_url).await;

    let (remote_digest, last_updated) = match remote_response {
        Ok(resp) => {
            if let Ok(tag_info) = resp.json::<DockerHubTag>().await {
                (tag_info.digest, tag_info.last_updated)
            } else {
                (None, None)
            }
        }
        Err(_) => (None, None),
    };

    let update_available = match (&local_digest, &remote_digest) {
        (Some(local), Some(remote)) => {
            // Compare the digest values
            !remote.contains(local)
        }
        (None, Some(_)) => true, // No local image, update available
        _ => false,
    };

    // Check if running container uses a different image than local latest
    let container_name = &state.container_config.container_name;
    let container_outdated = {
        let container_image_id = Command::new("docker")
            .args(["inspect", "--format", "{{.Image}}", container_name])
            .output()
            .await
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                } else {
                    None
                }
            });
        let local_image_id = Command::new("docker")
            .args(["inspect", "--format", "{{.Id}}", image])
            .output()
            .await
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                } else {
                    None
                }
            });
        match (container_image_id, local_image_id) {
            (Some(c), Some(l)) => c != l,
            _ => false,
        }
    };

    Ok(UpdateInfo {
        update_available,
        container_outdated,
        current_digest: local_digest,
        remote_digest,
        current_image: image.clone(),
        last_updated,
    })
}

/// Pull the latest image from Docker Hub.
#[tauri::command]
pub async fn pull_latest_image(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<String, String> {
    let state = state.lock().await;
    let image = &state.container_config.image;

    let output = Command::new("docker")
        .args(["pull", image])
        .output()
        .await
        .map_err(|e| format!("Failed to pull image: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// Get information about the currently pulled image.
#[tauri::command]
pub async fn get_current_image_info(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<ImageInfo, String> {
    let state = state.lock().await;
    let image = &state.container_config.image;

    let output = Command::new("docker")
        .args([
            "inspect",
            "--format",
            "{{.Id}}|{{.Created}}|{{.Size}}",
            image,
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to inspect image: {}", e))?;

    if output.status.success() {
        let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let parts: Vec<&str> = result.split('|').collect();

        Ok(ImageInfo {
            image: image.clone(),
            image_id: parts
                .first()
                .unwrap_or(&"unknown")
                .chars()
                .take(19)
                .collect(),
            created: parts.get(1).unwrap_or(&"unknown").to_string(),
            size: {
                let bytes: u64 = parts
                    .get(2)
                    .unwrap_or(&"0")
                    .parse()
                    .unwrap_or(0);
                format!("{:.1} GB", bytes as f64 / 1_073_741_824.0)
            },
        })
    } else {
        Ok(ImageInfo {
            image: image.clone(),
            image_id: "not pulled".to_string(),
            created: "N/A".to_string(),
            size: "N/A".to_string(),
        })
    }
}
