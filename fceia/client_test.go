package fceia_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/franelias/hackaton/fceia"
)

// versionedServer answers /subjects/6/relations with a subject_id equal to
// the number of requests it has seen so far.
func versionedServer(t *testing.T) *httptest.Server {
	t.Helper()
	var n atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"subject_id":` + string(rune('0'+n.Add(1))) + `,"prerequisites":[],"required_by":[]}`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

type fakeClock struct{ t atomic.Pointer[time.Time] }

func (c *fakeClock) now() time.Time  { return *c.t.Load() }
func (c *fakeClock) set(t time.Time) { c.t.Store(&t) }
func newClock() *fakeClock {
	c := &fakeClock{}
	c.set(time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC))
	return c
}

func TestRepeatedRequestWithinTTLReturnsTheCachedResponse(t *testing.T) {
	t.Parallel()
	srv := versionedServer(t)
	clock := newClock()
	c := fceia.New(srv.URL+"/api/v1", fceia.WithClock(clock.now), fceia.WithTTL(time.Hour))

	first, err := c.Relations(context.Background(), 6)
	if err != nil {
		t.Fatal(err)
	}
	clock.set(clock.now().Add(59 * time.Minute))
	second, err := c.Relations(context.Background(), 6)
	if err != nil {
		t.Fatal(err)
	}

	if first.SubjectID != 1 || second.SubjectID != 1 {
		t.Fatalf("subject ids = %d, %d; want 1, 1", first.SubjectID, second.SubjectID)
	}
}

func TestRequestAfterTTLFetchesFreshData(t *testing.T) {
	t.Parallel()
	srv := versionedServer(t)
	clock := newClock()
	c := fceia.New(srv.URL+"/api/v1", fceia.WithClock(clock.now), fceia.WithTTL(time.Hour))

	if _, err := c.Relations(context.Background(), 6); err != nil {
		t.Fatal(err)
	}
	clock.set(clock.now().Add(61 * time.Minute))
	fresh, err := c.Relations(context.Background(), 6)
	if err != nil {
		t.Fatal(err)
	}

	if fresh.SubjectID != 2 {
		t.Fatalf("subject id = %d, want 2", fresh.SubjectID)
	}
}

func TestAbsURLKeepsAbsoluteURLsAndPrefixesMediaPaths(t *testing.T) {
	t.Parallel()
	c := fceia.New("https://fceia-api.ariloc.ar/api/v1")

	if got := c.AbsURL("/media/a%20b.pdf"); got != "https://fceia-api.ariloc.ar/media/a%20b.pdf" {
		t.Fatalf("relative: %q", got)
	}
	if got := c.AbsURL("https://example.org/x.pdf"); got != "https://example.org/x.pdf" {
		t.Fatalf("absolute: %q", got)
	}
}
