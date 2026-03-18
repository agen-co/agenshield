/*
 * es_handler.h — EndpointSecurity event handler
 * Filters by monitored UIDs and dispatches policy checks to the daemon.
 */

#ifndef ES_HANDLER_H
#define ES_HANDLER_H

#include <EndpointSecurity/EndpointSecurity.h>
#include "config.h"
#include "cache.h"

/* Maximum arguments to include in policy check target string */
#define MAX_ARGS_FOR_CHECK  10
/* Maximum total length of concatenated arguments */
#define MAX_ARGS_TOTAL_LEN  4096

/*
 * Initialize the event handler with the given config and cache.
 * Must be called before creating the ES client.
 */
void handler_init(es_config_t *config, decision_cache_t *cache);

/*
 * Reload handler state from config (e.g., after SIGHUP).
 * Thread-safe — uses atomic swap.
 */
void handler_reload_config(es_config_t *config);

/*
 * The ES event handler block callback.
 * This is called by the ES subsystem for each event.
 */
void handler_handle_event(es_client_t *client, const es_message_t *msg);

/*
 * Check if a UID is in the monitored set.
 * Uses binary search on the sorted monitored_users array.
 */
bool handler_is_monitored_uid(uid_t uid);

#endif /* ES_HANDLER_H */
