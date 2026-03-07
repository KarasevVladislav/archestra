mod container;
mod logs;
mod pods;
mod runtime;
mod state;
mod updater;

use state::AppState;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let state = Arc::new(Mutex::new(AppState::new()));
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Runtime
            runtime::detect_runtime,
            runtime::start_runtime,
            runtime::stop_runtime,
            runtime::get_runtime_status,
            // Container
            container::get_container_status,
            container::start_container,
            container::stop_container,
            container::restart_container,
            container::recreate_container,
            container::get_container_config,
            container::set_container_config,
            // Logs
            logs::get_container_logs,
            logs::get_pod_logs,
            // Pods
            pods::list_pods,
            pods::restart_pod,
            pods::delete_pod,
            pods::describe_pod,
            pods::get_cluster_info,
            // Updater
            updater::check_for_updates,
            updater::pull_latest_image,
            updater::get_current_image_info,
            // Drizzle Studio
            container::toggle_drizzle_studio,
            container::get_drizzle_studio_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Archestra Desktop");
}
