/*
 * config.h — ES extension configuration
 * Reads /opt/agenshield/config/es-extension.json
 */

#ifndef CONFIG_H
#define CONFIG_H

#include <sys/types.h>
#include <stdbool.h>

#define CONFIG_PATH "/opt/agenshield/config/es-extension.json"
#define MAX_MONITORED_USERS 32
#define MAX_PATH_LEN 1024
#define MAX_USERNAME_LEN 64

typedef enum {
    MODE_MONITOR,   /* NOTIFY only — no blocking */
    MODE_AUDIT,     /* AUTH_EXEC, fail-open if daemon unreachable */
    MODE_ENFORCE    /* AUTH_EXEC, fail-closed if daemon unreachable */
} es_mode_t;

typedef struct {
    uid_t uid;
    char  name[MAX_USERNAME_LEN];
} monitored_user_t;

typedef struct {
    monitored_user_t monitored_users[MAX_MONITORED_USERS];
    int              monitored_user_count;

    char             daemon_socket_path[MAX_PATH_LEN];
    char             daemon_host[256];
    int              daemon_port;

    es_mode_t        mode;
    int              cache_ttl_seconds;
    int              cache_max_entries;

    time_t           last_loaded;
} es_config_t;

/* Load config from CONFIG_PATH. Returns 0 on success, -1 on error. */
int config_load(es_config_t *config);

/* Check if config file was modified since last load. */
bool config_needs_reload(const es_config_t *config);

/* Lookup a user name by UID. Returns NULL if not found. */
const char *config_username_for_uid(const es_config_t *config, uid_t uid);

#endif /* CONFIG_H */
