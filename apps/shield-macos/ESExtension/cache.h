/*
 * cache.h — LRU decision cache for ES extension
 * Caches policy decisions keyed by binary path + arguments hash.
 */

#ifndef CACHE_H
#define CACHE_H

#include <stdbool.h>
#include <stdint.h>
#include <time.h>

typedef enum {
    CACHE_ALLOW,
    CACHE_DENY
} cache_decision_t;

typedef struct cache_entry {
    uint64_t          key_hash;
    cache_decision_t  decision;
    time_t            expires_at;
    struct cache_entry *prev;
    struct cache_entry *next;
    struct cache_entry *hash_next;  /* hash chain */
} cache_entry_t;

typedef struct {
    cache_entry_t **buckets;
    int             bucket_count;
    cache_entry_t  *head;     /* most recently used */
    cache_entry_t  *tail;     /* least recently used */
    int             count;
    int             max_entries;
    int             ttl_seconds;
} decision_cache_t;

/* Initialize the cache. Returns 0 on success. */
int cache_init(decision_cache_t *cache, int max_entries, int ttl_seconds);

/* Lookup a decision. Returns true if found (and sets *decision), false on miss. */
bool cache_lookup(decision_cache_t *cache, const char *path, const char *args, cache_decision_t *decision);

/* Insert or update a cache entry. */
void cache_insert(decision_cache_t *cache, const char *path, const char *args, cache_decision_t decision);

/* Clear all entries. */
void cache_clear(decision_cache_t *cache);

/* Free all memory. */
void cache_destroy(decision_cache_t *cache);

/* Compute a hash key for a path + args combination. */
uint64_t cache_compute_key(const char *path, const char *args);

#endif /* CACHE_H */
