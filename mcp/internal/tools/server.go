// Package tools exposes the FCEIA API as MCP tools.
package tools

import (
	"time"

	"github.com/franelias/hackaton/mcp/internal/fceia"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type tools struct {
	api *fceia.Client
	now func() time.Time
}

// NewServer registers the nine read-only tools. A nil now uses time.Now.
func NewServer(api *fceia.Client, now func() time.Time) *mcp.Server {
	if now == nil {
		now = time.Now
	}
	t := &tools{api: api, now: now}
	s := mcp.NewServer(&mcp.Implementation{Name: "fceia-mcp", Version: "0.1.0"}, nil)

	mcp.AddTool(s, &mcp.Tool{
		Name:        "search_subject",
		Description: "Find FCEIA subjects by name (accent-insensitive). Returns subject_id values used by every other tool. A subject has a different subject_id in each career; the code is shared.",
	}, handle(t.searchSubject))
	mcp.AddTool(s, &mcp.Tool{
		Name:        "frequent_topics",
		Description: "Rank the topics most often evaluated in a subject's past exams, parsed from exam descriptions. topics are exact topic strings; keywords group them by shared words and pairs (with the number of exams that mention each), which is what to use for subjects with few exams. Exams without a date still count but cannot set last_year. since keeps only exams from that year on (undated exams are kept).",
	}, handle(t.frequentTopics))
	mcp.AddTool(s, &mcp.Tool{
		Name:        "exercises",
		Description: "Past exams of a subject with their full text, newest first, optionally filtered by topic and category. file_url is the original PDF; when scanned is true the text was read from a scan, so show the PDF too.",
	}, handle(t.exercises))
	mcp.AddTool(s, &mcp.Tool{
		Name:        "solution",
		Description: "Official solution for an exam. Only a minority of exams have one: check available before relying on text.",
	}, handle(t.solution))
	mcp.AddTool(s, &mcp.Tool{
		Name:        "search_materials",
		Description: "Search a subject's study materials (notes, slides) by text and return a snippet around the first match plus the file URL. Few subjects have materials.",
	}, handle(t.searchMaterials))
	mcp.AddTool(s, &mcp.Tool{
		Name:        "bibliography",
		Description: "Books in a subject's syllabus, with ISBN.",
	}, handle(t.bibliography))
	mcp.AddTool(s, &mcp.Tool{
		Name:        "prerequisites",
		Description: "What a subject requires (condition approved|regular) and which subjects it unlocks.",
	}, handle(t.prerequisites))
	mcp.AddTool(s, &mcp.Tool{
		Name:        "dates",
		Description: "Academic calendar events and exam-board (mesas) PDFs for a career. Many events have no dates, only notes and a source_url.",
	}, handle(t.dates))
	mcp.AddTool(s, &mcp.Tool{
		Name:        "build_schedule",
		Description: "Pick a weekly timetable without overlaps for the subjects a student wants to take. Chooses a commission per subject, ranks options (preferred shift, fewer days on campus, fewer gaps) and, when nothing fits, says which subjects clash and which to postpone, sparing bottleneck subjects. Pass approved_subject_ids/regular_subject_ids (from the student's tree) so subjects whose correlativas are not met are excluded.",
	}, handle(t.buildSchedule))
	return s
}
