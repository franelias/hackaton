package api

import (
	"net/http"
	"sync"
	"time"
)

// Request body caps: the chat carries an image of up to maxImageBytes in base64.
const (
	maxBody     = 1 << 20
	maxChatBody = maxImageBytes*4/3 + 64<<10
)

// limitBody caps every request body so a client can't make us read gigabytes.
func limitBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := int64(maxBody)
		if r.URL.Path == "/api/chat" {
			n = maxChatBody
		}
		r.Body = http.MaxBytesReader(w, r.Body, n)
		next.ServeHTTP(w, r)
	})
}

// Chat quotas per student: each message costs a model call, and Firebase
// sign-up is open, so anyone could otherwise burn the OpenRouter credit.
var chatQuotas = []struct {
	window time.Duration
	max    int
}{{time.Minute, 8}, {time.Hour, 60}, {24 * time.Hour, 200}}

// chatLimiter allows one turn at a time per student, within chatQuotas. The
// zero value is ready to use. State is in memory: fine for one instance.
type chatLimiter struct {
	mu    sync.Mutex
	busy  map[int]bool
	sends map[int][]time.Time
}

// acquire reserves a turn for student at now and returns a release func, or a
// message for the student when they have to wait.
func (l *chatLimiter) acquire(student int, now time.Time) (func(), string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.busy == nil {
		l.busy, l.sends = map[int]bool{}, map[int][]time.Time{}
	}
	if l.busy[student] {
		return nil, "Esperá a que el tutor termine de responder."
	}
	longest := chatQuotas[len(chatQuotas)-1].window
	sends := l.sends[student]
	for len(sends) > 0 && now.Sub(sends[0]) >= longest {
		sends = sends[1:]
	}
	for _, q := range chatQuotas {
		n := 0
		for _, t := range sends {
			if now.Sub(t) < q.window {
				n++
			}
		}
		if n >= q.max {
			l.sends[student] = sends
			return nil, "Mandaste muchos mensajes seguidos. Tomate un respiro y probá de nuevo en un rato."
		}
	}
	l.sends[student] = append(sends, now)
	l.busy[student] = true
	return func() {
		l.mu.Lock()
		delete(l.busy, student)
		l.mu.Unlock()
	}, ""
}
