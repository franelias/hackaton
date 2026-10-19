// Package fceia is a minimal read-only client for the FCEIA API
// (https://fceia-api.ariloc.ar/docs), limited to what the plan needs.
package fceia

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const DefaultBase = "https://fceia-api.ariloc.ar/api/v1"

type Client struct {
	base string
	http *http.Client
}

func New(base string) *Client {
	return &Client{base: strings.TrimRight(base, "/"), http: &http.Client{Timeout: 20 * time.Second}}
}

type Career struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type Subject struct {
	ID   int    `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
	Year *int   `json:"year"`
	Term *int   `json:"term"`
	Kind string `json:"kind"`
}

type Curriculum struct {
	CareerID       int                  `json:"career_id"`
	SubjectsByYear map[string][]Subject `json:"subjects_by_year"`
}

type Prerequisite struct {
	RelatedSubjectID int    `json:"related_subject_id"`
	Requirement      string `json:"requirement"`
}

type Relations struct {
	SubjectID     int            `json:"subject_id"`
	Prerequisites []Prerequisite `json:"prerequisites"`
}

func (c *Client) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: status %d", path, resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (c *Client) Career(ctx context.Context, id int) (Career, error) {
	var out Career
	err := c.get(ctx, "/careers/"+strconv.Itoa(id), &out)
	return out, err
}

func (c *Client) Curriculum(ctx context.Context, careerID int) (Curriculum, error) {
	var out Curriculum
	err := c.get(ctx, "/careers/"+strconv.Itoa(careerID)+"/curriculum", &out)
	return out, err
}

func (c *Client) Relations(ctx context.Context, subjectID int) (Relations, error) {
	var out Relations
	err := c.get(ctx, "/subjects/"+strconv.Itoa(subjectID)+"/relations", &out)
	return out, err
}
