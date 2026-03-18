/*
 * es_handler.c — EndpointSecurity event handler implementation
 *
 * Fast-path: Non-monitored UIDs get immediate ALLOW (no allocation, no dispatch).
 * Monitored UIDs: Retained message dispatched to worker queue for async daemon query.
 */

#include "es_handler.h"
#include "daemon_client.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <dispatch/dispatch.h>
#include <bsm/libbsm.h>
#include <os/log.h>

static os_log_t g_log = OS_LOG_DEFAULT;
static es_config_t *g_config = NULL;
static decision_cache_t *g_cache = NULL;
static dispatch_queue_t g_worker_queue = NULL;

static void ensure_log(void) {
    static bool inited = false;
    if (!inited) {
        g_log = os_log_create("com.frontegg.AgenShield", "handler");
        inited = true;
    }
}

void handler_init(es_config_t *config, decision_cache_t *cache) {
    ensure_log();
    g_config = config;
    g_cache = cache;
    g_worker_queue = dispatch_queue_create("com.frontegg.AgenShield.worker",
                                           DISPATCH_QUEUE_CONCURRENT);
}

void handler_reload_config(es_config_t *config) {
    g_config = config;
    cache_clear(g_cache);
    os_log_info(g_log, "Handler config reloaded, cache cleared");
}

bool handler_is_monitored_uid(uid_t uid) {
    if (!g_config || g_config->monitored_user_count == 0) return false;

    /* Binary search on sorted array */
    int lo = 0, hi = g_config->monitored_user_count - 1;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        uid_t mid_uid = g_config->monitored_users[mid].uid;
        if (mid_uid == uid) return true;
        if (mid_uid < uid) lo = mid + 1;
        else hi = mid - 1;
    }
    return false;
}

/* Extract arguments from exec event into a buffer */
static void extract_args(const es_message_t *msg, char *buf, size_t bufsz) {
    size_t offset = 0;
    /* arg 0 is the binary path, start from 1 */
    uint32_t argc = es_exec_arg_count(&msg->event.exec);
    uint32_t limit = argc < MAX_ARGS_FOR_CHECK + 1 ? argc : MAX_ARGS_FOR_CHECK + 1;

    for (uint32_t i = 1; i < limit; i++) {
        es_string_token_t arg = es_exec_arg(&msg->event.exec, i);
        if (arg.length == 0) continue;

        size_t remaining = bufsz - offset - 1;
        if (remaining < arg.length + 1) break;

        if (offset > 0) buf[offset++] = ' ';
        memcpy(buf + offset, arg.data, arg.length);
        offset += arg.length;
    }
    buf[offset] = '\0';
}

/* Process a monitored exec event (runs on worker queue) */
static void process_monitored_exec(es_client_t *client, const es_message_t *msg, uid_t euid) {
    const es_event_exec_t *exec = &msg->event.exec;
    const char *binary_path = exec->target->executable->path.data;
    pid_t pid = audit_token_to_pid(exec->target->audit_token);
    pid_t ppid = msg->process->ppid;
    au_asid_t session_id = audit_token_to_asid(msg->process->audit_token);

    /* Extract arguments */
    char args[MAX_ARGS_TOTAL_LEN];
    extract_args(msg, args, sizeof(args));

    const char *user_name = config_username_for_uid(g_config, euid);

    os_log_info(g_log, "Monitored exec: user=%{public}s pid=%d path=%{public}s",
                user_name ? user_name : "?", (int)pid, binary_path);

    /* Check cache first */
    cache_decision_t cached;
    if (cache_lookup(g_cache, binary_path, args, &cached)) {
        os_log_debug(g_log, "Cache hit: %{public}s → %{public}s",
                     binary_path, cached == CACHE_ALLOW ? "allow" : "deny");

        if (msg->action_type == ES_ACTION_TYPE_AUTH) {
            es_auth_result_t result = (cached == CACHE_ALLOW)
                ? ES_AUTH_RESULT_ALLOW : ES_AUTH_RESULT_DENY;
            es_respond_auth_result(client, msg, result, false);
        }
        es_release_message(msg);
        return;
    }

    /* Query daemon */
    daemon_response_t resp;
    int rc = daemon_policy_check(
        g_config->daemon_socket_path,
        g_config->daemon_host,
        g_config->daemon_port,
        binary_path, args, user_name,
        pid, ppid, (int)session_id,
        &resp
    );

    bool allowed;

    if (rc != 0) {
        /* Daemon unreachable — apply fail mode */
        switch (g_config->mode) {
        case MODE_MONITOR:
            allowed = true;
            os_log_info(g_log, "Daemon unreachable (monitor mode): allowing");
            break;
        case MODE_AUDIT:
            allowed = true;
            os_log_info(g_log, "Daemon unreachable (audit mode): fail-open, allowing");
            break;
        case MODE_ENFORCE:
            allowed = false;
            os_log_error(g_log, "Daemon unreachable (enforce mode): fail-closed, DENYING %{public}s",
                         binary_path);
            break;
        }
    } else {
        allowed = resp.allowed;
        os_log_info(g_log, "Daemon decision: %{public}s → %{public}s (policy=%{public}s reason=%{public}s)",
                    binary_path, allowed ? "allow" : "deny",
                    resp.policy_id, resp.reason);

        /* Cache the decision */
        cache_insert(g_cache, binary_path, args,
                     allowed ? CACHE_ALLOW : CACHE_DENY);
    }

    /* Respond if AUTH event */
    if (msg->action_type == ES_ACTION_TYPE_AUTH) {
        es_auth_result_t result = allowed ? ES_AUTH_RESULT_ALLOW : ES_AUTH_RESULT_DENY;
        es_respond_auth_result(client, msg, result, false);
    }

    es_release_message(msg);
}


void handler_handle_event(es_client_t *client, const es_message_t *msg) {
    /* We only handle exec events */
    if (msg->event_type != ES_EVENT_TYPE_NOTIFY_EXEC &&
        msg->event_type != ES_EVENT_TYPE_AUTH_EXEC) {
        if (msg->action_type == ES_ACTION_TYPE_AUTH) {
            es_respond_auth_result(client, msg, ES_AUTH_RESULT_ALLOW, true);
        }
        return;
    }

    uid_t euid = audit_token_to_euid(msg->process->audit_token);

    /* Fast-path: non-monitored UID → immediate allow */
    if (!handler_is_monitored_uid(euid)) {
        if (msg->action_type == ES_ACTION_TYPE_AUTH) {
            es_respond_auth_result(client, msg, ES_AUTH_RESULT_ALLOW, true);
        }
        return;
    }

    /* Monitored user → async processing */
    es_retain_message(msg);
    dispatch_async(g_worker_queue, ^{
        process_monitored_exec(client, msg, euid);
    });
}
