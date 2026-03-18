/*
 * daemon_client.c — AgenShield daemon JSON-RPC client
 *
 * Sends policy_check requests via Unix socket (preferred) or HTTP fallback.
 * Uses raw sockets — no external HTTP library dependencies.
 */

#include "daemon_client.h"
#include "config.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <os/log.h>
#include <stdatomic.h>

static os_log_t g_log = OS_LOG_DEFAULT;
static atomic_uint_fast64_t g_request_counter = 0;

static void ensure_log(void) {
    static bool inited = false;
    if (!inited) {
        g_log = os_log_create("com.frontegg.AgenShield", "daemon");
        inited = true;
    }
}

/* ---- JSON escaping ---- */

static void json_escape(const char *src, char *dst, size_t dstsz) {
    size_t j = 0;
    for (size_t i = 0; src[i] && j < dstsz - 2; i++) {
        switch (src[i]) {
        case '"':  if (j + 2 < dstsz) { dst[j++] = '\\'; dst[j++] = '"'; } break;
        case '\\': if (j + 2 < dstsz) { dst[j++] = '\\'; dst[j++] = '\\'; } break;
        case '\n': if (j + 2 < dstsz) { dst[j++] = '\\'; dst[j++] = 'n'; } break;
        case '\r': if (j + 2 < dstsz) { dst[j++] = '\\'; dst[j++] = 'r'; } break;
        case '\t': if (j + 2 < dstsz) { dst[j++] = '\\'; dst[j++] = 't'; } break;
        default:   dst[j++] = src[i]; break;
        }
    }
    dst[j] = '\0';
}

/* ---- Build JSON-RPC request ---- */

static int build_request(char *buf, size_t bufsz,
                         const char *binary_path, const char *args,
                         const char *user_name, pid_t pid, pid_t ppid,
                         int session_id) {
    uint64_t id = atomic_fetch_add(&g_request_counter, 1);

    /* Build target: "binary_path args" */
    char target_escaped[4096];
    char target_raw[4096];
    snprintf(target_raw, sizeof(target_raw), "%s %s", binary_path, args ? args : "");
    json_escape(target_raw, target_escaped, sizeof(target_escaped));

    char user_escaped[MAX_USERNAME_LEN * 2];
    json_escape(user_name ? user_name : "unknown", user_escaped, sizeof(user_escaped));

    int written = snprintf(buf, bufsz,
        "{"
            "\"jsonrpc\":\"2.0\","
            "\"id\":\"es-%llu\","
            "\"method\":\"policy_check\","
            "\"params\":{"
                "\"operation\":\"exec\","
                "\"target\":\"%s\","
                "\"context\":{"
                    "\"callerType\":\"agent\","
                    "\"depth\":0,"
                    "\"sourceLayer\":\"es-extension\","
                    "\"esUser\":\"%s\","
                    "\"esPid\":%d,"
                    "\"esPpid\":%d,"
                    "\"esSessionId\":%d"
                "}"
            "}"
        "}",
        (unsigned long long)id,
        target_escaped,
        user_escaped,
        (int)pid, (int)ppid, session_id
    );
    return written;
}

/* ---- Socket helpers ---- */

static int set_nonblocking(int fd) {
    int flags = fcntl(fd, F_GETFL, 0);
    if (flags == -1) return -1;
    return fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

static int connect_with_timeout(int fd, struct sockaddr *addr, socklen_t len, int timeout_ms) {
    set_nonblocking(fd);

    int ret = connect(fd, addr, len);
    if (ret == 0) return 0;
    if (errno != EINPROGRESS) return -1;

    struct pollfd pfd = { .fd = fd, .events = POLLOUT };
    ret = poll(&pfd, 1, timeout_ms);
    if (ret <= 0) return -1;

    int err = 0;
    socklen_t errlen = sizeof(err);
    getsockopt(fd, SOL_SOCKET, SO_ERROR, &err, &errlen);
    if (err != 0) { errno = err; return -1; }

    /* Restore blocking mode */
    int flags = fcntl(fd, F_GETFL, 0);
    fcntl(fd, F_SETFL, flags & ~O_NONBLOCK);

    return 0;
}

/* Send data and receive response with timeout */
static int send_recv(int fd, const char *data, size_t datalen,
                     char *resp, size_t respsz, int timeout_ms) {
    /* Send all data */
    size_t sent = 0;
    while (sent < datalen) {
        ssize_t n = write(fd, data + sent, datalen - sent);
        if (n <= 0) return -1;
        sent += (size_t)n;
    }

    /* Receive with timeout */
    struct pollfd pfd = { .fd = fd, .events = POLLIN };
    size_t total = 0;

    while (total < respsz - 1) {
        int ret = poll(&pfd, 1, timeout_ms);
        if (ret <= 0) break;

        ssize_t n = read(fd, resp + total, respsz - 1 - total);
        if (n <= 0) break;
        total += (size_t)n;

        /* Check if we have a complete JSON response (simple heuristic) */
        resp[total] = '\0';
        /* For Unix socket: look for closing brace */
        if (strchr(resp, '}')) break;
    }
    resp[total] = '\0';
    return total > 0 ? 0 : -1;
}

/* ---- Unix socket transport ---- */

static int try_unix_socket(const char *socket_path, const char *body, size_t bodylen,
                           char *resp, size_t respsz) {
    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) return -1;

    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strlcpy(addr.sun_path, socket_path, sizeof(addr.sun_path));

    if (connect_with_timeout(fd, (struct sockaddr *)&addr, sizeof(addr),
                             DAEMON_CONNECT_TIMEOUT_MS) != 0) {
        close(fd);
        return -1;
    }

    int ret = send_recv(fd, body, bodylen, resp, respsz, DAEMON_TIMEOUT_MS);
    close(fd);
    return ret;
}

/* ---- HTTP transport ---- */

static int try_http(const char *host, int port, const char *body, size_t bodylen,
                    char *resp, size_t respsz) {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return -1;

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons((uint16_t)port);
    inet_pton(AF_INET, host, &addr.sin_addr);

    if (connect_with_timeout(fd, (struct sockaddr *)&addr, sizeof(addr),
                             DAEMON_CONNECT_TIMEOUT_MS) != 0) {
        close(fd);
        return -1;
    }

    /* Build HTTP request */
    char http_req[DAEMON_MAX_RESPONSE];
    int hdrlen = snprintf(http_req, sizeof(http_req),
        "POST /rpc HTTP/1.1\r\n"
        "Host: %s:%d\r\n"
        "Content-Type: application/json\r\n"
        "Content-Length: %zu\r\n"
        "Connection: close\r\n"
        "\r\n",
        host, port, bodylen
    );

    /* Send headers */
    if (write(fd, http_req, (size_t)hdrlen) != hdrlen) { close(fd); return -1; }
    /* Send body */
    if (write(fd, body, bodylen) != (ssize_t)bodylen) { close(fd); return -1; }

    /* Read response */
    char raw_resp[DAEMON_MAX_RESPONSE];
    struct pollfd pfd = { .fd = fd, .events = POLLIN };
    size_t total = 0;

    while (total < sizeof(raw_resp) - 1) {
        int ret = poll(&pfd, 1, DAEMON_TIMEOUT_MS);
        if (ret <= 0) break;

        ssize_t n = read(fd, raw_resp + total, sizeof(raw_resp) - 1 - total);
        if (n <= 0) break;
        total += (size_t)n;
    }
    raw_resp[total] = '\0';
    close(fd);

    if (total == 0) return -1;

    /* Extract JSON body from HTTP response (skip headers) */
    const char *body_start = strstr(raw_resp, "\r\n\r\n");
    if (body_start) {
        body_start += 4;
        strlcpy(resp, body_start, respsz);
    } else {
        strlcpy(resp, raw_resp, respsz);
    }

    return 0;
}

/* ---- Parse JSON-RPC response ---- */

static int parse_response(const char *json, daemon_response_t *resp) {
    memset(resp, 0, sizeof(*resp));

    /* Check for error */
    if (strstr(json, "\"error\"")) {
        resp->allowed = false;
        strlcpy(resp->reason, "daemon returned error", sizeof(resp->reason));
        return 0;
    }

    /* Look for "allowed" in result */
    const char *allowed_pos = strstr(json, "\"allowed\"");
    if (!allowed_pos) {
        /* No allowed field — treat as error */
        resp->allowed = false;
        strlcpy(resp->reason, "malformed response", sizeof(resp->reason));
        return -1;
    }

    /* Find the value after "allowed": */
    const char *val = allowed_pos + strlen("\"allowed\"");
    while (*val && (*val == ':' || *val == ' ' || *val == '\t')) val++;
    resp->allowed = (strncmp(val, "true", 4) == 0);

    /* Extract policyId if present */
    const char *pid_pos = strstr(json, "\"policyId\"");
    if (pid_pos) {
        pid_pos = strchr(pid_pos + 10, '"');
        if (pid_pos) {
            pid_pos++;
            size_t i = 0;
            while (*pid_pos && *pid_pos != '"' && i < sizeof(resp->policy_id) - 1) {
                resp->policy_id[i++] = *pid_pos++;
            }
            resp->policy_id[i] = '\0';
        }
    }

    /* Extract reason if present */
    const char *reason_pos = strstr(json, "\"reason\"");
    if (reason_pos) {
        reason_pos = strchr(reason_pos + 8, '"');
        if (reason_pos) {
            reason_pos++;
            size_t i = 0;
            while (*reason_pos && *reason_pos != '"' && i < sizeof(resp->reason) - 1) {
                if (*reason_pos == '\\' && *(reason_pos + 1)) reason_pos++;
                resp->reason[i++] = *reason_pos++;
            }
            resp->reason[i] = '\0';
        }
    }

    return 0;
}

/* ---- Public API ---- */

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
    daemon_response_t *response)
{
    ensure_log();

    char body[8192];
    int bodylen = build_request(body, sizeof(body), binary_path, args,
                                user_name, pid, ppid, session_id);
    if (bodylen <= 0) return -1;

    char resp_buf[DAEMON_MAX_RESPONSE];

    /* Try Unix socket first */
    if (socket_path && socket_path[0]) {
        if (try_unix_socket(socket_path, body, (size_t)bodylen,
                            resp_buf, sizeof(resp_buf)) == 0) {
            os_log_debug(g_log, "Daemon response via socket");
            return parse_response(resp_buf, response);
        }
        os_log_info(g_log, "Unix socket failed, falling back to HTTP");
    }

    /* HTTP fallback */
    if (try_http(http_host, http_port, body, (size_t)bodylen,
                 resp_buf, sizeof(resp_buf)) == 0) {
        os_log_debug(g_log, "Daemon response via HTTP");
        return parse_response(resp_buf, response);
    }

    os_log_error(g_log, "Failed to reach daemon via socket or HTTP");
    return -1;
}

bool daemon_ping(const char *socket_path, const char *http_host, int http_port) {
    const char *ping_body = "{\"jsonrpc\":\"2.0\",\"id\":\"ping\",\"method\":\"ping\",\"params\":{}}";
    size_t ping_len = strlen(ping_body);
    char resp[1024];

    if (socket_path && socket_path[0]) {
        if (try_unix_socket(socket_path, ping_body, ping_len, resp, sizeof(resp)) == 0)
            return true;
    }

    return try_http(http_host, http_port, ping_body, ping_len, resp, sizeof(resp)) == 0;
}
