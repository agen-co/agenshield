/*
 * config.c — ES extension configuration loader
 * Parses /opt/agenshield/config/es-extension.json
 *
 * Minimal JSON parser — no external dependencies. The config format is
 * simple enough that we can parse it with basic string scanning.
 */

#include "config.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <os/log.h>

static os_log_t g_log = OS_LOG_DEFAULT;

static void ensure_log(void) {
    static bool inited = false;
    if (!inited) {
        g_log = os_log_create("com.frontegg.AgenShield", "config");
        inited = true;
    }
}

/* ---- Minimal JSON helpers ---- */

/* Skip whitespace, return pointer to next non-ws char */
static const char *skip_ws(const char *p) {
    while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r') p++;
    return p;
}

/* Extract a JSON string value (without quotes) into buf. Returns pointer past closing quote. */
static const char *json_read_string(const char *p, char *buf, size_t bufsz) {
    p = skip_ws(p);
    if (*p != '"') return NULL;
    p++;
    size_t i = 0;
    while (*p && *p != '"' && i < bufsz - 1) {
        if (*p == '\\' && *(p + 1)) { p++; }  /* skip escape */
        buf[i++] = *p++;
    }
    buf[i] = '\0';
    if (*p == '"') p++;
    return p;
}

/* Extract a JSON integer value. Returns pointer past the number. */
static const char *json_read_int(const char *p, int *out) {
    p = skip_ws(p);
    char *end = NULL;
    long val = strtol(p, &end, 10);
    if (end == p) return NULL;
    *out = (int)val;
    return end;
}

/* Find the position of a JSON key in the object. Returns pointer to the value. */
static const char *json_find_key(const char *json, const char *key) {
    char search[256];
    snprintf(search, sizeof(search), "\"%s\"", key);
    const char *pos = strstr(json, search);
    if (!pos) return NULL;
    pos += strlen(search);
    pos = skip_ws(pos);
    if (*pos == ':') pos++;
    return skip_ws(pos);
}

/* Parse monitoredUsers array */
static int parse_monitored_users(const char *arr, es_config_t *config) {
    config->monitored_user_count = 0;
    const char *p = skip_ws(arr);
    if (*p != '[') return -1;
    p++;

    while (config->monitored_user_count < MAX_MONITORED_USERS) {
        p = skip_ws(p);
        if (*p == ']') break;
        if (*p == ',') { p++; continue; }
        if (*p != '{') break;
        p++;

        monitored_user_t *user = &config->monitored_users[config->monitored_user_count];
        memset(user, 0, sizeof(*user));

        /* Parse object fields */
        while (*p && *p != '}') {
            p = skip_ws(p);
            if (*p == ',') { p++; continue; }
            if (*p != '"') break;

            char field[64] = {0};
            p = json_read_string(p, field, sizeof(field));
            if (!p) break;
            p = skip_ws(p);
            if (*p == ':') p++;
            p = skip_ws(p);

            if (strcmp(field, "uid") == 0) {
                int uid = 0;
                p = json_read_int(p, &uid);
                if (!p) break;
                user->uid = (uid_t)uid;
            } else if (strcmp(field, "name") == 0) {
                p = json_read_string(p, user->name, sizeof(user->name));
                if (!p) break;
            } else {
                /* skip unknown value */
                if (*p == '"') {
                    char tmp[256];
                    p = json_read_string(p, tmp, sizeof(tmp));
                } else {
                    while (*p && *p != ',' && *p != '}') p++;
                }
            }
        }
        if (*p == '}') p++;
        config->monitored_user_count++;
    }
    return 0;
}

/* Compare function for qsort/bsearch on uid_t */
static int uid_compare(const void *a, const void *b) {
    uid_t ua = ((const monitored_user_t *)a)->uid;
    uid_t ub = ((const monitored_user_t *)b)->uid;
    if (ua < ub) return -1;
    if (ua > ub) return 1;
    return 0;
}

int config_load(es_config_t *config) {
    ensure_log();

    FILE *f = fopen(CONFIG_PATH, "r");
    if (!f) {
        os_log_error(g_log, "Failed to open config file: %{public}s", CONFIG_PATH);
        return -1;
    }

    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    fseek(f, 0, SEEK_SET);

    if (sz <= 0 || sz > 65536) {
        os_log_error(g_log, "Config file size invalid: %ld", sz);
        fclose(f);
        return -1;
    }

    char *buf = calloc(1, (size_t)sz + 1);
    if (!buf) { fclose(f); return -1; }
    fread(buf, 1, (size_t)sz, f);
    fclose(f);

    /* Set defaults */
    memset(config, 0, sizeof(*config));
    strlcpy(config->daemon_socket_path, "/var/run/agenshield/agenshield.sock", MAX_PATH_LEN);
    strlcpy(config->daemon_host, "127.0.0.1", sizeof(config->daemon_host));
    config->daemon_port = 5200;
    config->mode = MODE_MONITOR;
    config->cache_ttl_seconds = 30;
    config->cache_max_entries = 1024;

    /* Parse monitoredUsers */
    const char *users_val = json_find_key(buf, "monitoredUsers");
    if (users_val) {
        parse_monitored_users(users_val, config);
    }

    /* Parse daemonSocketPath */
    const char *sock_val = json_find_key(buf, "daemonSocketPath");
    if (sock_val && *sock_val == '"') {
        json_read_string(sock_val, config->daemon_socket_path, MAX_PATH_LEN);
    }

    /* Parse daemonHost */
    const char *host_val = json_find_key(buf, "daemonHost");
    if (host_val && *host_val == '"') {
        json_read_string(host_val, config->daemon_host, sizeof(config->daemon_host));
    }

    /* Parse daemonPort */
    const char *port_val = json_find_key(buf, "daemonPort");
    if (port_val) {
        int port = 0;
        if (json_read_int(port_val, &port)) config->daemon_port = port;
    }

    /* Parse mode */
    const char *mode_val = json_find_key(buf, "mode");
    if (mode_val && *mode_val == '"') {
        char mode_str[32] = {0};
        json_read_string(mode_val, mode_str, sizeof(mode_str));
        if (strcmp(mode_str, "audit") == 0) config->mode = MODE_AUDIT;
        else if (strcmp(mode_str, "enforce") == 0) config->mode = MODE_ENFORCE;
        else config->mode = MODE_MONITOR;
    }

    /* Parse cacheTtlSeconds */
    const char *ttl_val = json_find_key(buf, "cacheTtlSeconds");
    if (ttl_val) {
        int ttl = 0;
        if (json_read_int(ttl_val, &ttl)) config->cache_ttl_seconds = ttl;
    }

    /* Parse cacheMaxEntries */
    const char *max_val = json_find_key(buf, "cacheMaxEntries");
    if (max_val) {
        int max = 0;
        if (json_read_int(max_val, &max)) config->cache_max_entries = max;
    }

    /* Sort monitored users by UID for binary search */
    if (config->monitored_user_count > 1) {
        qsort(config->monitored_users, (size_t)config->monitored_user_count,
              sizeof(monitored_user_t), uid_compare);
    }

    struct stat st;
    if (stat(CONFIG_PATH, &st) == 0) {
        config->last_loaded = st.st_mtime;
    }

    free(buf);

    os_log_info(g_log, "Config loaded: %d monitored users, mode=%{public}s",
                config->monitored_user_count,
                config->mode == MODE_MONITOR ? "monitor" :
                config->mode == MODE_AUDIT ? "audit" : "enforce");

    return 0;
}

bool config_needs_reload(const es_config_t *config) {
    struct stat st;
    if (stat(CONFIG_PATH, &st) != 0) return false;
    return st.st_mtime > config->last_loaded;
}

const char *config_username_for_uid(const es_config_t *config, uid_t uid) {
    for (int i = 0; i < config->monitored_user_count; i++) {
        if (config->monitored_users[i].uid == uid)
            return config->monitored_users[i].name;
    }
    return NULL;
}
