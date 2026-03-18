/*
 * daemon_client.h — Communication with the AgenShield daemon
 * Sends policy_check JSON-RPC requests via Unix socket or HTTP fallback.
 */

#ifndef DAEMON_CLIENT_H
#define DAEMON_CLIENT_H

#include <stdbool.h>
#include <sys/types.h>

#define DAEMON_TIMEOUT_MS      3000   /* Total query timeout */
#define DAEMON_CONNECT_TIMEOUT_MS 1000 /* Socket connect timeout before HTTP fallback */
#define DAEMON_MAX_RESPONSE    65536

typedef struct {
    bool allowed;
    char policy_id[128];
    char reason[512];
} daemon_response_t;

/*
 * Send a policy_check request to the daemon.
 * Tries Unix socket first, falls back to HTTP.
 *
 * Returns 0 on success (response populated), -1 on communication failure.
 * On failure, the caller should apply the fail mode logic.
 */
int daemon_policy_check(
    const char *socket_path,
    const char *http_host,
    int         http_port,
    const char *binary_path,
    const char *args,
    const char *user_name,
    pid_t       pid,
    pid_t       ppid,
    int         session_id,
    daemon_response_t *response
);

/*
 * Check if the daemon is reachable (ping).
 * Returns true if reachable.
 */
bool daemon_ping(const char *socket_path, const char *http_host, int http_port);

#endif /* DAEMON_CLIENT_H */
