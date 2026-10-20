package api

import (
	"sync"
	"time"
)

// namesTTL is how long a plan name is kept: plans are replaced by a CLI
// import, not through the API, so a stale name just waits for the next expiry.
const namesTTL = 10 * time.Minute

// planKey identifies a career or a subject within its faculty.
type planKey struct {
	faculty string
	id      int
}

// lookup keeps what load returned for a key for namesTTL. The zero value is
// ready to use. A failed load is not kept.
type lookup[K comparable, V any] struct {
	mu sync.Mutex
	m  map[K]kept[V]
}

type kept[V any] struct {
	v   V
	exp time.Time
}

func (c *lookup[K, V]) get(k K, load func() (V, error)) (V, error) {
	c.mu.Lock()
	e, ok := c.m[k]
	c.mu.Unlock()
	if ok && time.Now().Before(e.exp) {
		return e.v, nil
	}
	v, err := load() // outside the lock: two misses may both load, which is harmless
	if err != nil {
		return v, err
	}
	c.mu.Lock()
	if c.m == nil {
		c.m = map[K]kept[V]{}
	}
	c.m[k] = kept[V]{v, time.Now().Add(namesTTL)}
	c.mu.Unlock()
	return v, nil
}
