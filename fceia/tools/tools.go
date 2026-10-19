// Package tools holds the read-only FCEIA operations (search_subject,
// exercises, build_schedule…) shared by the MCP server and the backend tutor.
// Each one is a plain function; List describes them for any tool-calling
// client, with JSON Schemas generated from the input and output types.
package tools

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/jsonschema-go/jsonschema"

	"github.com/franelias/hackaton/fceia"
)

type Tools struct {
	api *fceia.Client
	now func() time.Time
}

// New builds the tools over api. A nil now uses time.Now.
func New(api *fceia.Client, now func() time.Time) *Tools {
	if now == nil {
		now = time.Now
	}
	return &Tools{api: api, now: now}
}

// Tool is one operation described for a tool-calling client.
type Tool struct {
	Name         string
	Description  string
	InputSchema  *jsonschema.Schema
	OutputSchema *jsonschema.Schema
	// Call decodes the JSON arguments and runs the operation. Errors carry a
	// contract code (see Code).
	Call func(ctx context.Context, args json.RawMessage) (any, error)
}

func tool[In, Out any](name, description string, run func(context.Context, In) (Out, error)) Tool {
	in, err := jsonschema.For[In](nil)
	if err != nil {
		panic(err)
	}
	out, err := jsonschema.For[Out](nil)
	if err != nil {
		panic(err)
	}
	return Tool{
		Name: name, Description: description, InputSchema: in, OutputSchema: out,
		Call: func(ctx context.Context, args json.RawMessage) (any, error) {
			var v In
			if len(args) > 0 {
				if err := json.Unmarshal(args, &v); err != nil {
					return nil, invalidArgument("invalid arguments: " + err.Error())
				}
			}
			res, err := run(ctx, v)
			if err != nil {
				return nil, err
			}
			return res, nil
		},
	}
}

// List returns the nine tools.
func (t *Tools) List() []Tool {
	return []Tool{
		tool("search_subject", "Find FCEIA subjects by name (accent-insensitive). Returns subject_id values used by every other tool. A subject has a different subject_id in each career; the code is shared.", t.searchSubject),
		tool("frequent_topics", "Rank the topics most often evaluated in a subject's past exams, parsed from exam descriptions. topics are exact topic strings; keywords group them by shared words and pairs (with the number of exams that mention each), which is what to use for subjects with few exams. Exams without a date still count but cannot set last_year. since keeps only exams from that year on (undated exams are kept).", t.frequentTopics),
		tool("exercises", "Past exams of a subject with their full text, newest first, optionally filtered by topic and category. file_url is the original PDF; when scanned is true the text was read from a scan, so show the PDF too.", t.exercises),
		tool("solution", "Official solution for an exam. Only a minority of exams have one: check available before relying on text.", t.solution),
		tool("search_materials", "Search a subject's study materials (notes, slides) by text and return a snippet around the first match plus the file URL. Few subjects have materials.", t.searchMaterials),
		tool("bibliography", "Books in a subject's syllabus, with ISBN.", t.bibliography),
		tool("prerequisites", "What a subject requires (condition approved|regular) and which subjects it unlocks.", t.prerequisites),
		tool("dates", "Academic calendar events and exam-board (mesas) PDFs for a career. Many events have no dates, only notes and a source_url.", t.dates),
		tool("build_schedule", "Pick a weekly timetable without overlaps for the subjects a student wants to take. Chooses a commission per subject, ranks options (preferred shift, fewer days on campus, fewer gaps) and, when nothing fits, says which subjects clash and which to postpone, sparing bottleneck subjects. Pass approved_subject_ids/regular_subject_ids (from the student's tree) so subjects whose correlativas are not met are excluded.", t.BuildSchedule),
	}
}
