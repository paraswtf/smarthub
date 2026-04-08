#pragma once

// ─── Debug ────────────────────────────────────────────────────
// Set to 1 to enable verbose serial output, 0 for production.
// When disabled, all DBG_* macros compile to nothing - zero overhead.
#define DEBUG_MODE 1

// ─── Captive-portal AP settings ──────────────────────────────
// AP_SSID is a prefix - CaptivePortal appends the last 3 MAC bytes (e.g. "SmartHUB-A1B2C3")
#define AP_SSID_PREFIX "SmartHUB-"
#define AP_PASSWORD "" // open network
#define AP_IP "192.168.4.1"
#define AP_GATEWAY "192.168.4.1"
#define AP_SUBNET "255.255.255.0"

// ─── Timing ───────────────────────────────────────────────────
#define WIFI_CONNECT_TIMEOUT_MS 15000   // max wait for WiFi on boot
#define WS_RECONNECT_INTERVAL_MS 5000   // delay between WS reconnect attempts
#define HEARTBEAT_INTERVAL_MS 60000     // how often to send heartbeat (60s)
#define CONFIG_PORTAL_TIMEOUT_MS 300000 // 5 min - reboot if nobody configures

// ─── Max relays / regulators ──────────────────────────────────
#define MAX_RELAYS 8
#define MAX_REGULATORS 4

// ─── Max server-managed WiFi networks (wn1–wn4, in addition to captive-portal wn0) ──
#define MAX_WIFI_NETWORKS 4

// ─── NVS namespace ────────────────────────────────────────────
#define NVS_NAMESPACE "esp_hub"

// ─── LED pin (optional - set to -1 to disable) ────────────────
// Blink pattern:
//   Fast blink  → AP / captive portal mode
//   Slow blink  → connecting to WiFi / WS
//   Solid ON    → connected & authenticated
#define STATUS_LED_PIN 2           // onboard LED on most ESP32 dev boards
#define STATUS_LED_ACTIVE_LOW true // set false if LED is active-high