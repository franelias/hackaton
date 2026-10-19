// Package fceia is a read-only client for the FCEIA API (https://fceia-api.ariloc.ar/docs).
package fceia

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	DefaultBase = "https://fceia-api.ariloc.ar/api/v1"
	pageSize    = 100
)

var (
	ErrNotFound    = errors.New("not found")
	ErrUnavailable = errors.New("FCEIA API unavailable")
)

// Client caches successful GET responses by URL for ttl.
type Client struct {
	base string
	http *http.Client
	now  func() time.Time
	ttl  time.Duration

	mu    sync.Mutex
	cache map[string]cacheEntry
}

type cacheEntry struct {
	body    []byte
	expires time.Time
}

type Option func(*Client)

func WithHTTPClient(h *http.Client) Option  { return func(c *Client) { c.http = h } }
func WithClock(now func() time.Time) Option { return func(c *Client) { c.now = now } }
func WithTTL(ttl time.Duration) Option      { return func(c *Client) { c.ttl = ttl } }

func New(base string, opts ...Option) *Client {
	c := &Client{
		base:  strings.TrimRight(base, "/"),
		http:  &http.Client{Timeout: 20 * time.Second},
		now:   time.Now,
		ttl:   time.Hour,
		cache: map[string]cacheEntry{},
	}
	for _, o := range opts {
		o(c)
	}
	return c
}

// Origin is the base URL without the /api/v1 suffix, where /media files live.
func (c *Client) Origin() string {
	return strings.TrimSuffix(c.base, "/api/v1")
}

// AbsURL turns a relative /media path into an absolute URL. Empty stays empty.
func (c *Client) AbsURL(p string) string {
	if p == "" || strings.HasPrefix(p, "http://") || strings.HasPrefix(p, "https://") {
		return p
	}
	return c.Origin() + "/" + strings.TrimLeft(p, "/")
}

func (c *Client) get(ctx context.Context, path string, q url.Values, out any) error {
	u := c.base + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}

	c.mu.Lock()
	e, ok := c.cache[u]
	c.mu.Unlock()
	if ok && c.now().Before(e.expires) {
		return json.Unmarshal(e.body, out)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return fmt.Errorf("%w: %s", ErrNotFound, path)
	case resp.StatusCode >= 400:
		return fmt.Errorf("%w: %s returned %d", ErrUnavailable, path, resp.StatusCode)
	}

	c.mu.Lock()
	c.cache[u] = cacheEntry{body: body, expires: c.now().Add(c.ttl)}
	c.mu.Unlock()
	return json.Unmarshal(body, out)
}

type page[T any] struct {
	Items  []T `json:"items"`
	Total  int `json:"total"`
	Limit  int `json:"limit"`
	Offset int `json:"offset"`
}

func list[T any](ctx context.Context, c *Client, path string, q url.Values) ([]T, error) {
	var all []T
	for offset := 0; ; {
		qq := url.Values{}
		for k, v := range q {
			qq[k] = v
		}
		qq.Set("limit", strconv.Itoa(pageSize))
		qq.Set("offset", strconv.Itoa(offset))
		var p page[T]
		if err := c.get(ctx, path, qq, &p); err != nil {
			return nil, err
		}
		all = append(all, p.Items...)
		offset += len(p.Items)
		if len(p.Items) == 0 || offset >= p.Total {
			return all, nil
		}
	}
}

// --- DTOs (only the fields the tools use) ---

type Subject struct {
	ID       int    `json:"id"`
	Code     string `json:"code"`
	Name     string `json:"name"`
	CareerID int    `json:"career_id"`
	Year     *int   `json:"year"`
	Term     *int   `json:"term"`
}

type Exam struct {
	ID          int    `json:"id"`
	SubjectID   *int   `json:"subject_id"`
	Category    string `json:"category"`
	Date        string `json:"date"`
	Title       string `json:"title"`
	Description string `json:"description"`
	FileURL     string `json:"file_url"`
	HasText     bool   `json:"has_text"`
	HasSolution bool   `json:"has_solution"`
	SolutionID  *int   `json:"solution_id"`
}

type Material struct {
	ID      int    `json:"id"`
	Kind    string `json:"kind"`
	Title   string `json:"title"`
	URL     string `json:"url"`
	HasText bool   `json:"has_text"`
}

type Text struct {
	ID    int    `json:"id"`
	Title string `json:"title"`
	Text  string `json:"text"`
}

type Book struct {
	Title  string `json:"title"`
	Author string `json:"author"`
	Year   *int   `json:"year"`
	ISBN   string `json:"isbn"`
	Kind   string `json:"kind"`
}

type Prerequisite struct {
	RelatedSubjectID int    `json:"related_subject_id"`
	RelatedCode      string `json:"related_code"`
	Requirement      string `json:"requirement"`
}

type RequiredBy struct {
	SubjectID   int    `json:"subject_id"`
	SubjectName string `json:"subject_name"`
}

type Relations struct {
	SubjectID     int            `json:"subject_id"`
	Prerequisites []Prerequisite `json:"prerequisites"`
	RequiredBy    []RequiredBy   `json:"required_by"`
}

type CalendarEvent struct {
	Kind      string  `json:"kind"`
	Label     string  `json:"label"`
	StartsOn  *string `json:"starts_on"`
	EndsOn    *string `json:"ends_on"`
	Notes     string  `json:"notes"`
	SourceURL string  `json:"source_url"`
}

type ExamBoard struct {
	Label       string `json:"label"`
	SessionKind string `json:"session_kind"`
	PDFURL      string `json:"pdf_url"`
	Notes       string `json:"notes"`
}

// --- Endpoints ---

func (c *Client) SearchSubjects(ctx context.Context, name string, careerID int) ([]Subject, error) {
	q := url.Values{"q": {name}}
	if careerID != 0 {
		q.Set("career_id", strconv.Itoa(careerID))
	}
	return list[Subject](ctx, c, "/subjects", q)
}

// Exams lists a subject's exams, optionally restricted to a category.
func (c *Client) Exams(ctx context.Context, subjectID int, category string) ([]Exam, error) {
	q := url.Values{"subject_id": {strconv.Itoa(subjectID)}}
	if category != "" {
		q.Set("category", category)
	}
	return list[Exam](ctx, c, "/exams", q)
}

func (c *Client) Exam(ctx context.Context, id int) (Exam, error) {
	var e Exam
	err := c.get(ctx, "/exams/"+strconv.Itoa(id), nil, &e)
	return e, err
}

func (c *Client) ExamText(ctx context.Context, id int) (Text, error) {
	var t Text
	err := c.get(ctx, "/exams/"+strconv.Itoa(id)+"/text", nil, &t)
	return t, err
}

func (c *Client) SolutionText(ctx context.Context, id int) (Text, error) {
	var t Text
	err := c.get(ctx, "/solutions/"+strconv.Itoa(id)+"/text", nil, &t)
	return t, err
}

// Materials searches a subject's materials; the API's text filter is
// accent- and case-sensitive, so callers pass each spelling variant.
func (c *Client) Materials(ctx context.Context, subjectID int, text string) ([]Material, error) {
	q := url.Values{"subject_id": {strconv.Itoa(subjectID)}, "text": {text}}
	return list[Material](ctx, c, "/materials", q)
}

func (c *Client) MaterialText(ctx context.Context, id int) (Text, error) {
	var t Text
	err := c.get(ctx, "/materials/"+strconv.Itoa(id)+"/text", nil, &t)
	return t, err
}

func (c *Client) Bibliography(ctx context.Context, subjectID int) ([]Book, error) {
	return list[Book](ctx, c, "/subjects/"+strconv.Itoa(subjectID)+"/bibliography", nil)
}

func (c *Client) Relations(ctx context.Context, subjectID int) (Relations, error) {
	var r Relations
	err := c.get(ctx, "/subjects/"+strconv.Itoa(subjectID)+"/relations", nil, &r)
	return r, err
}

func (c *Client) Calendar(ctx context.Context, year int) ([]CalendarEvent, error) {
	return list[CalendarEvent](ctx, c, "/calendar", url.Values{"year": {strconv.Itoa(year)}})
}

func (c *Client) ExamBoards(ctx context.Context, careerID int) ([]ExamBoard, error) {
	return list[ExamBoard](ctx, c, "/exam-boards", url.Values{"career_id": {strconv.Itoa(careerID)}})
}
