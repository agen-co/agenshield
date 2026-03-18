/*
 * main.c — AgenShield EndpointSecurity System Extension entry point
 *
 * Lifecycle:
 * 1. Load configuration from /opt/agenshield/config/es-extension.json
 * 2. Initialize decision cache
 * 3. Create ES client with event handler
 * 4. Subscribe to EXEC events (NOTIFY or AUTH based on mode)
 * 5. Mute known system paths for performance
 * 6. Enter dispatch_main() — never returns
 *
 * SIGHUP: Reload configuration and clear cache
 * Config polling: Check mtime every 60 seconds
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <dispatch/dispatch.h>
#include <EndpointSecurity/EndpointSecurity.h>
#include <os/log.h>

#include "config.h"
#include "cache.h"
#include "es_handler.h"

static os_log_t g_log = OS_LOG_DEFAULT;
static es_config_t g_config;
static decision_cache_t g_cache;
static es_client_t *g_client = NULL;

/* Paths to mute for performance — these are system binaries we never need to check */
static const char *MUTED_PATHS[] = {
    "/usr/libexec/",
    "/System/Library/",
    "/usr/sbin/notifyd",
    "/usr/sbin/cfprefsd",
    "/usr/libexec/logd",
    NULL
};

static void mute_system_paths(es_client_t *client) {
    for (int i = 0; MUTED_PATHS[i] != NULL; i++) {
        /* Mute by path prefix — reduces event volume significantly */
        es_mute_path(client, MUTED_PATHS[i], ES_MUTE_PATH_TYPE_PREFIX);
    }

    /* Also mute our own process */
    audit_token_t self_token;
    mach_msg_type_number_t count = TASK_AUDIT_TOKEN_COUNT;
    task_info(mach_task_self(), TASK_AUDIT_TOKEN, (task_info_t)&self_token, &count);
    es_mute_process(client, &self_token);

    os_log_info(g_log, "System paths muted for performance");
}

static void reload_config(void) {
    os_log_info(g_log, "Reloading configuration...");
    es_config_t new_config;

    if (config_load(&new_config) == 0) {
        /* Swap config */
        memcpy(&g_config, &new_config, sizeof(es_config_t));
        handler_reload_config(&g_config);
        os_log_info(g_log, "Configuration reloaded successfully");
    } else {
        os_log_error(g_log, "Failed to reload configuration, keeping current config");
    }
}

static void sighup_handler(int sig __attribute__((unused))) {
    /* Dispatch reload to main queue to avoid signal-handler restrictions */
    dispatch_async(dispatch_get_main_queue(), ^{
        reload_config();
    });
}

static void setup_config_polling(void) {
    dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0,
                                                     dispatch_get_main_queue());
    /* Poll every 60 seconds */
    dispatch_source_set_timer(timer,
                              dispatch_time(DISPATCH_TIME_NOW, 60LL * NSEC_PER_SEC),
                              60ULL * NSEC_PER_SEC,
                              5ULL * NSEC_PER_SEC);  /* 5s leeway for power savings */

    dispatch_source_set_event_handler(timer, ^{
        if (config_needs_reload(&g_config)) {
            os_log_info(g_log, "Config file changed on disk, reloading");
            reload_config();
        }
    });

    dispatch_resume(timer);
}

int main(int argc __attribute__((unused)), char *argv[] __attribute__((unused))) {
    g_log = os_log_create("com.frontegg.AgenShield", "main");
    os_log_info(g_log, "AgenShield ES Extension starting");

    /* Step 1: Load configuration */
    if (config_load(&g_config) != 0) {
        os_log_error(g_log, "Failed to load config — using defaults");
        /* Continue with defaults (monitor mode, no monitored users) */
    }

    if (g_config.monitored_user_count == 0) {
        os_log_error(g_log, "WARNING: No monitored users configured — extension will not filter any processes");
    }

    /* Step 2: Initialize cache */
    if (cache_init(&g_cache, g_config.cache_max_entries, g_config.cache_ttl_seconds) != 0) {
        os_log_fault(g_log, "Failed to initialize cache");
        return 1;
    }

    /* Step 3: Initialize handler */
    handler_init(&g_config, &g_cache);

    /* Step 4: Create ES client */
    es_new_client_result_t result = es_new_client(&g_client,
        ^(es_client_t *client, const es_message_t *msg) {
            handler_handle_event(client, msg);
        }
    );

    if (result != ES_NEW_CLIENT_RESULT_SUCCESS) {
        const char *err = "unknown";
        switch (result) {
        case ES_NEW_CLIENT_RESULT_ERR_NOT_ENTITLED:
            err = "missing com.apple.developer.endpoint-security.client entitlement";
            break;
        case ES_NEW_CLIENT_RESULT_ERR_NOT_PERMITTED:
            err = "not permitted (needs Full Disk Access or TCC approval)";
            break;
        case ES_NEW_CLIENT_RESULT_ERR_NOT_PRIVILEGED:
            err = "not running as root";
            break;
        case ES_NEW_CLIENT_RESULT_ERR_TOO_MANY_CLIENTS:
            err = "too many ES clients";
            break;
        case ES_NEW_CLIENT_RESULT_ERR_INVALID_ARGUMENT:
            err = "invalid argument";
            break;
        case ES_NEW_CLIENT_RESULT_ERR_INTERNAL:
            err = "ES internal error";
            break;
        default:
            break;
        }
        os_log_fault(g_log, "Failed to create ES client: %{public}s", err);
        return 1;
    }

    os_log_info(g_log, "ES client created successfully");

    /* Step 5: Mute system paths */
    mute_system_paths(g_client);

    /* Step 6: Subscribe to events based on mode */
    es_event_type_t events[1];

    if (g_config.mode == MODE_MONITOR) {
        events[0] = ES_EVENT_TYPE_NOTIFY_EXEC;
        os_log_info(g_log, "Subscribing to NOTIFY_EXEC (monitor mode)");
    } else {
        events[0] = ES_EVENT_TYPE_AUTH_EXEC;
        os_log_info(g_log, "Subscribing to AUTH_EXEC (%{public}s mode)",
                    g_config.mode == MODE_AUDIT ? "audit" : "enforce");
    }

    if (es_subscribe(g_client, events, 1) != ES_RETURN_SUCCESS) {
        os_log_fault(g_log, "Failed to subscribe to exec events");
        es_delete_client(g_client);
        return 1;
    }

    os_log_info(g_log, "Event subscription active — monitoring %d user(s)",
                g_config.monitored_user_count);

    /* Step 7: Setup SIGHUP handler for config reload */
    signal(SIGHUP, sighup_handler);

    /* Step 8: Setup config file polling (every 60s) */
    setup_config_polling();

    /* Step 9: Enter run loop — never returns */
    os_log_info(g_log, "AgenShield ES Extension running");
    dispatch_main();

    /* Unreachable */
    return 0;
}
