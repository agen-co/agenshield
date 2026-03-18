/*
 * cache.c — LRU decision cache implementation
 * Uses FNV-1a hash with open chaining for collision resolution.
 */

#include "cache.h"

#include <stdlib.h>
#include <string.h>
#include <time.h>

/* FNV-1a 64-bit hash */
static uint64_t fnv1a_64(const void *data, size_t len) {
    const uint8_t *p = (const uint8_t *)data;
    uint64_t hash = 0xcbf29ce484222325ULL;
    for (size_t i = 0; i < len; i++) {
        hash ^= p[i];
        hash *= 0x100000001b3ULL;
    }
    return hash;
}

uint64_t cache_compute_key(const char *path, const char *args) {
    uint64_t h = fnv1a_64(path, strlen(path));
    /* Mix in a separator to avoid "ab"+"c" == "a"+"bc" */
    uint8_t sep = 0;
    h ^= sep;
    h *= 0x100000001b3ULL;
    if (args) {
        h ^= fnv1a_64(args, strlen(args));
    }
    return h;
}

int cache_init(decision_cache_t *cache, int max_entries, int ttl_seconds) {
    memset(cache, 0, sizeof(*cache));
    cache->max_entries = max_entries > 0 ? max_entries : 1024;
    cache->ttl_seconds = ttl_seconds > 0 ? ttl_seconds : 30;

    /* Use ~2x entries for bucket count to reduce collisions */
    cache->bucket_count = cache->max_entries * 2;
    cache->buckets = calloc((size_t)cache->bucket_count, sizeof(cache_entry_t *));
    if (!cache->buckets) return -1;

    return 0;
}

/* Remove entry from LRU doubly-linked list */
static void lru_remove(decision_cache_t *cache, cache_entry_t *entry) {
    if (entry->prev) entry->prev->next = entry->next;
    else cache->head = entry->next;

    if (entry->next) entry->next->prev = entry->prev;
    else cache->tail = entry->prev;

    entry->prev = NULL;
    entry->next = NULL;
}

/* Move entry to front of LRU list */
static void lru_push_front(decision_cache_t *cache, cache_entry_t *entry) {
    entry->prev = NULL;
    entry->next = cache->head;
    if (cache->head) cache->head->prev = entry;
    cache->head = entry;
    if (!cache->tail) cache->tail = entry;
}

/* Remove entry from hash bucket chain */
static void hash_remove(decision_cache_t *cache, cache_entry_t *entry) {
    int bucket = (int)(entry->key_hash % (uint64_t)cache->bucket_count);
    cache_entry_t **pp = &cache->buckets[bucket];
    while (*pp) {
        if (*pp == entry) {
            *pp = entry->hash_next;
            entry->hash_next = NULL;
            return;
        }
        pp = &(*pp)->hash_next;
    }
}

/* Evict the LRU (tail) entry */
static void evict_lru(decision_cache_t *cache) {
    cache_entry_t *victim = cache->tail;
    if (!victim) return;
    lru_remove(cache, victim);
    hash_remove(cache, victim);
    free(victim);
    cache->count--;
}

bool cache_lookup(decision_cache_t *cache, const char *path, const char *args, cache_decision_t *decision) {
    uint64_t key = cache_compute_key(path, args);
    int bucket = (int)(key % (uint64_t)cache->bucket_count);
    time_t now = time(NULL);

    cache_entry_t *entry = cache->buckets[bucket];
    while (entry) {
        if (entry->key_hash == key) {
            /* Check TTL */
            if (entry->expires_at <= now) {
                /* Expired — remove and return miss */
                lru_remove(cache, entry);
                hash_remove(cache, entry);
                free(entry);
                cache->count--;
                return false;
            }
            *decision = entry->decision;
            /* Promote to MRU */
            lru_remove(cache, entry);
            lru_push_front(cache, entry);
            return true;
        }
        entry = entry->hash_next;
    }
    return false;
}

void cache_insert(decision_cache_t *cache, const char *path, const char *args, cache_decision_t decision) {
    uint64_t key = cache_compute_key(path, args);
    int bucket = (int)(key % (uint64_t)cache->bucket_count);
    time_t now = time(NULL);

    /* Check if already exists */
    cache_entry_t *entry = cache->buckets[bucket];
    while (entry) {
        if (entry->key_hash == key) {
            entry->decision = decision;
            entry->expires_at = now + cache->ttl_seconds;
            lru_remove(cache, entry);
            lru_push_front(cache, entry);
            return;
        }
        entry = entry->hash_next;
    }

    /* Evict if at capacity */
    while (cache->count >= cache->max_entries) {
        evict_lru(cache);
    }

    /* Create new entry */
    entry = calloc(1, sizeof(cache_entry_t));
    if (!entry) return;

    entry->key_hash = key;
    entry->decision = decision;
    entry->expires_at = now + cache->ttl_seconds;

    /* Add to hash bucket */
    entry->hash_next = cache->buckets[bucket];
    cache->buckets[bucket] = entry;

    /* Add to LRU front */
    lru_push_front(cache, entry);
    cache->count++;
}

void cache_clear(decision_cache_t *cache) {
    cache_entry_t *entry = cache->head;
    while (entry) {
        cache_entry_t *next = entry->next;
        free(entry);
        entry = next;
    }
    memset(cache->buckets, 0, (size_t)cache->bucket_count * sizeof(cache_entry_t *));
    cache->head = NULL;
    cache->tail = NULL;
    cache->count = 0;
}

void cache_destroy(decision_cache_t *cache) {
    cache_clear(cache);
    free(cache->buckets);
    cache->buckets = NULL;
}
