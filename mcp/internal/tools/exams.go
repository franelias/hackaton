package tools

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"

	"github.com/franelias/hackaton/mcp/internal/fceia"
)

const (
	defaultLimit = 3
	maxLimit     = 10
)

var categories = map[string]bool{"parcial": true, "final": true, "recuperatorio": true, "coloquio": true, "quiz": true}

func examYear(e fceia.Exam) int {
	if len(e.Date) < 4 {
		return 0
	}
	y, err := strconv.Atoi(e.Date[:4])
	if err != nil {
		return 0
	}
	return y
}

// --- frequent_topics ---

type frequentTopicsIn struct {
	SubjectID int `json:"subject_id" jsonschema:"subject_id from search_subject"`
	Since     int `json:"since,omitempty" jsonschema:"only exams from this year on, e.g. 2020"`
}

type frequentTopicsOut struct {
	SubjectID     int          `json:"subject_id"`
	ExamsAnalyzed int          `json:"exams_analyzed"`
	Undated       int          `json:"undated"`
	Topics        []topicCount `json:"topics"`
	// Keywords groups the free-text topics by shared words, so a subject with
	// few exams still shows what keeps coming up ("deducción natural": 7).
	Keywords []keywordCount `json:"keywords"`
}

func (t *tools) frequentTopics(ctx context.Context, in frequentTopicsIn) (frequentTopicsOut, error) {
	if in.SubjectID <= 0 {
		return frequentTopicsOut{}, invalidArgument("subject_id must be positive")
	}
	exams, err := t.api.Exams(ctx, in.SubjectID, "")
	if err != nil {
		return frequentTopicsOut{}, err
	}
	out := frequentTopicsOut{SubjectID: in.SubjectID}
	tally := newTopicTally()
	keywords := newKeywordTally()
	for _, e := range exams {
		year := examYear(e)
		if in.Since > 0 && year != 0 && year < in.Since {
			continue
		}
		out.ExamsAnalyzed++
		if year == 0 {
			out.Undated++
		}
		topics := examTopics(e.Description)
		tally.add(topics, year)
		keywords.add(topics, year)
	}
	out.Topics = tally.ranked()
	out.Keywords = keywords.ranked()
	if out.Keywords == nil {
		out.Keywords = []keywordCount{}
	}
	return out, nil
}

// --- exercises ---

type exercisesIn struct {
	SubjectID int    `json:"subject_id" jsonschema:"subject_id from search_subject"`
	Topic     string `json:"topic,omitempty" jsonschema:"keep exams whose title or description mention this topic"`
	Category  string `json:"category,omitempty" jsonschema:"parcial, final, recuperatorio, coloquio or quiz"`
	Limit     int    `json:"limit,omitempty" jsonschema:"how many exams to return (default 3, max 10)"`
}

type exerciseOut struct {
	ExamID      int    `json:"exam_id"`
	Title       string `json:"title"`
	Category    string `json:"category"`
	Date        string `json:"date"`
	Text        string `json:"text"`
	FileURL     string `json:"file_url"`
	Scanned     bool   `json:"scanned"`
	HasSolution bool   `json:"has_solution"`
	SolutionID  *int   `json:"solution_id"`
}

type exercisesOut struct {
	Exercises []exerciseOut `json:"exercises"`
}

func limitOrDefault(n int) (int, error) {
	switch {
	case n < 0:
		return 0, invalidArgument("limit must not be negative")
	case n == 0:
		return defaultLimit, nil
	case n > maxLimit:
		return maxLimit, nil
	}
	return n, nil
}

func (t *tools) exercises(ctx context.Context, in exercisesIn) (exercisesOut, error) {
	if in.SubjectID <= 0 {
		return exercisesOut{}, invalidArgument("subject_id must be positive")
	}
	if in.Category != "" && !categories[in.Category] {
		return exercisesOut{}, invalidArgument("category must be one of parcial, final, recuperatorio, coloquio, quiz")
	}
	limit, err := limitOrDefault(in.Limit)
	if err != nil {
		return exercisesOut{}, err
	}
	exams, err := t.api.Exams(ctx, in.SubjectID, in.Category)
	if err != nil {
		return exercisesOut{}, err
	}

	// The API's text filter is accent-sensitive, so match here instead.
	var matching []fceia.Exam
	for _, e := range exams {
		if in.Topic == "" || containsFolded(e.Title+" "+e.Description, in.Topic) {
			matching = append(matching, e)
		}
	}
	sort.SliceStable(matching, func(i, j int) bool { return matching[i].Date > matching[j].Date })
	if len(matching) > limit {
		matching = matching[:limit]
	}

	out := exercisesOut{Exercises: []exerciseOut{}}
	for _, e := range matching {
		ex := exerciseOut{
			ExamID: e.ID, Title: e.Title, Category: e.Category, Date: e.Date,
			FileURL: t.api.AbsURL(e.FileURL), Scanned: strings.Contains(fold(e.Description), "escane"),
			HasSolution: e.HasSolution, SolutionID: e.SolutionID,
		}
		if e.HasText {
			txt, err := t.api.ExamText(ctx, e.ID)
			if err != nil && !errors.Is(err, fceia.ErrNotFound) {
				return exercisesOut{}, err
			}
			ex.Text = txt.Text
		}
		out.Exercises = append(out.Exercises, ex)
	}
	return out, nil
}

// --- solution ---

type solutionIn struct {
	ExamID int `json:"exam_id" jsonschema:"exam_id from exercises"`
}

type solutionOut struct {
	ExamID    int    `json:"exam_id"`
	Available bool   `json:"available"`
	Text      string `json:"text"`
}

func (t *tools) solution(ctx context.Context, in solutionIn) (solutionOut, error) {
	if in.ExamID <= 0 {
		return solutionOut{}, invalidArgument("exam_id must be positive")
	}
	exam, err := t.api.Exam(ctx, in.ExamID)
	if err != nil {
		return solutionOut{}, err
	}
	if !exam.HasSolution || exam.SolutionID == nil {
		return solutionOut{ExamID: in.ExamID}, nil
	}
	txt, err := t.api.SolutionText(ctx, *exam.SolutionID)
	if err != nil {
		return solutionOut{}, err
	}
	return solutionOut{ExamID: in.ExamID, Available: true, Text: txt.Text}, nil
}
