#pragma once
#include <Arduino.h>
#include "Config.h"

// ─── ANSI colour codes (most serial monitors support these) ───
#define _CLR_RESET "\033[0m"
#define _CLR_GREY "\033[90m"
#define _CLR_RED "\033[91m"
#define _CLR_GREEN "\033[92m"
#define _CLR_YELLOW "\033[93m"
#define _CLR_BLUE "\033[94m"
#define _CLR_MAGENTA "\033[95m"
#define _CLR_CYAN "\033[96m"
#define _CLR_WHITE "\033[97m"
#define _CLR_BOLD "\033[1m"

// ─── Tag colours ──────────────────────────────────────────────
#define _TAG_MAIN _CLR_BOLD _CLR_WHITE "[MAIN]" _CLR_RESET " "
#define _TAG_WIFI _CLR_BOLD _CLR_CYAN "[WIFI]" _CLR_RESET " "
#define _TAG_HUB _CLR_BOLD _CLR_GREEN "[HUB]" _CLR_RESET " "
#define _TAG_WS _CLR_BOLD _CLR_MAGENTA "[WS]" _CLR_RESET " "
#define _TAG_RELAY _CLR_BOLD _CLR_YELLOW "[RELAY]" _CLR_RESET " "
#define _TAG_PORTAL _CLR_BOLD _CLR_BLUE "[PORTAL]" _CLR_RESET " "
#define _TAG_STORAGE _CLR_BOLD _CLR_GREY "[NVS]" _CLR_RESET " "
#define _TAG_ERR _CLR_BOLD _CLR_RED "[ERROR]" _CLR_RESET " "
#define _TAG_WARN _CLR_BOLD _CLR_YELLOW "[WARN]" _CLR_RESET " "

// ─── Timestamp helper ─────────────────────────────────────────
// Prints elapsed time in [HH:MM:SS.mmm] format before every message
static inline void _printTimestamp()
{
    uint32_t ms = millis();
    uint32_t s = ms / 1000;
    uint32_t m = s / 60;
    uint32_t h = m / 60;
    Serial.printf(_CLR_GREY "[%02lu:%02lu:%02lu.%03lu]" _CLR_RESET " ",
                  h, m % 60, s % 60, ms % 1000);
}

// ─── Core macros ──────────────────────────────────────────────
#if DEBUG_MODE

// General log  - DBG_LOG(TAG, fmt, ...)
#define DBG_LOG(tag, fmt, ...)                      \
    do                                              \
    {                                               \
        _printTimestamp();                          \
        Serial.printf(tag fmt "\n", ##__VA_ARGS__); \
    } while (0)

// Error (red)
#define DBG_ERR(fmt, ...) \
    DBG_LOG(_TAG_ERR, _CLR_RED fmt _CLR_RESET, ##__VA_ARGS__)

// Warning (yellow)
#define DBG_WARN(fmt, ...) \
    DBG_LOG(_TAG_WARN, _CLR_YELLOW fmt _CLR_RESET, ##__VA_ARGS__)

// Section-specific shorthands
#define DBG_MAIN(fmt, ...) DBG_LOG(_TAG_MAIN, fmt, ##__VA_ARGS__)
#define DBG_WIFI(fmt, ...) DBG_LOG(_TAG_WIFI, fmt, ##__VA_ARGS__)
#define DBG_HUB(fmt, ...) DBG_LOG(_TAG_HUB, fmt, ##__VA_ARGS__)
#define DBG_WS(fmt, ...) DBG_LOG(_TAG_WS, fmt, ##__VA_ARGS__)
#define DBG_RELAY(fmt, ...) DBG_LOG(_TAG_RELAY, fmt, ##__VA_ARGS__)
#define DBG_PORTAL(fmt, ...) DBG_LOG(_TAG_PORTAL, fmt, ##__VA_ARGS__)
#define DBG_STORAGE(fmt, ...) DBG_LOG(_TAG_STORAGE, fmt, ##__VA_ARGS__)

// Dump a raw buffer as hex - useful for inspecting WS payloads
#define DBG_HEX(label, buf, len)                                               \
    do                                                                         \
    {                                                                          \
        _printTimestamp();                                                     \
        Serial.printf(_CLR_GREY label " (%d bytes): " _CLR_RESET, (int)(len)); \
        for (size_t _i = 0; _i < (size_t)(len); _i++)                          \
            Serial.printf("%02X ", ((uint8_t *)(buf))[_i]);                    \
        Serial.println();                                                      \
    } while (0)

// Print heap / stack stats - call anywhere to track memory
#define DBG_HEAP()                                                                                           \
    do                                                                                                       \
    {                                                                                                        \
        _printTimestamp();                                                                                   \
        Serial.printf(_CLR_GREY "[MEM] Free heap: %lu B  Min ever: %lu B  Stack HWM: %lu B" _CLR_RESET "\n", \
                      (unsigned long)ESP.getFreeHeap(),                                                      \
                      (unsigned long)ESP.getMinFreeHeap(),                                                   \
                      (unsigned long)uxTaskGetStackHighWaterMark(NULL) * 4);                                 \
    } while (0)

// Print WiFi diagnostics
#define DBG_WIFI_STATUS()                                                                             \
    do                                                                                                \
    {                                                                                                 \
        _printTimestamp();                                                                            \
        Serial.printf(_CLR_CYAN "[WIFI] SSID: %s  IP: %s  RSSI: %d dBm  Channel: %d" _CLR_RESET "\n", \
                      WiFi.SSID().c_str(),                                                            \
                      WiFi.localIP().toString().c_str(),                                              \
                      WiFi.RSSI(),                                                                    \
                      WiFi.channel());                                                                \
    } while (0)

// Mark a code section with a visible banner
#define DBG_BANNER(label)                                                            \
    do                                                                               \
    {                                                                                \
        Serial.println();                                                            \
        Serial.println(_CLR_BOLD "────────────────────────────────────" _CLR_RESET); \
        Serial.println(_CLR_BOLD "  " label _CLR_RESET);                             \
        Serial.println(_CLR_BOLD "────────────────────────────────────" _CLR_RESET); \
    } while (0)

// Assert - halts with an error message if condition is false
#define DBG_ASSERT(cond, msg)                                      \
    do                                                             \
    {                                                              \
        if (!(cond))                                               \
        {                                                          \
            DBG_ERR("ASSERT FAILED: " msg " (line %d)", __LINE__); \
            while (1)                                              \
            {                                                      \
                delay(1000);                                       \
            }                                                      \
        }                                                          \
    } while (0)

#else
// ── Production: all macros compile to nothing ──────────────
#define DBG_LOG(tag, fmt, ...) \
    do                         \
    {                          \
    } while (0)
#define DBG_ERR(fmt, ...) \
    do                    \
    {                     \
    } while (0)
#define DBG_WARN(fmt, ...) \
    do                     \
    {                      \
    } while (0)
#define DBG_MAIN(fmt, ...) \
    do                     \
    {                      \
    } while (0)
#define DBG_WIFI(fmt, ...) \
    do                     \
    {                      \
    } while (0)
#define DBG_HUB(fmt, ...) \
    do                    \
    {                     \
    } while (0)
#define DBG_WS(fmt, ...) \
    do                   \
    {                    \
    } while (0)
#define DBG_RELAY(fmt, ...) \
    do                      \
    {                       \
    } while (0)
#define DBG_PORTAL(fmt, ...) \
    do                       \
    {                        \
    } while (0)
#define DBG_STORAGE(fmt, ...) \
    do                        \
    {                         \
    } while (0)
#define DBG_HEX(label, buf, len) \
    do                           \
    {                            \
    } while (0)
#define DBG_HEAP() \
    do             \
    {              \
    } while (0)
#define DBG_WIFI_STATUS() \
    do                    \
    {                     \
    } while (0)
#define DBG_BANNER(label) \
    do                    \
    {                     \
    } while (0)
#define DBG_ASSERT(cond, msg) \
    do                        \
    {                         \
    } while (0)
#endif