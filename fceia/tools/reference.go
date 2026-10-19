package tools

import "context"

// --- bibliography ---

type subjectIn struct {
	SubjectID int `json:"subject_id" jsonschema:"subject_id from search_subject"`
}

type bookOut struct {
	Title  string `json:"title"`
	Author string `json:"author"`
	Year   *int   `json:"year"`
	ISBN   string `json:"isbn"`
	Kind   string `json:"kind"`
}

type bibliographyOut struct {
	Books []bookOut `json:"books"`
}

func (t *Tools) bibliography(ctx context.Context, in subjectIn) (bibliographyOut, error) {
	if in.SubjectID <= 0 {
		return bibliographyOut{}, invalidArgument("subject_id must be positive")
	}
	books, err := t.api.Bibliography(ctx, in.SubjectID)
	if err != nil {
		return bibliographyOut{}, err
	}
	out := bibliographyOut{Books: []bookOut{}}
	for _, b := range books {
		out.Books = append(out.Books, bookOut{b.Title, b.Author, b.Year, b.ISBN, b.Kind})
	}
	return out, nil
}

// --- prerequisites ---

type requirementOut struct {
	SubjectID int    `json:"subject_id"`
	Code      string `json:"code"`
	Condition string `json:"condition"`
}

type unlockOut struct {
	SubjectID int    `json:"subject_id"`
	Name      string `json:"name"`
}

type prerequisitesOut struct {
	SubjectID int              `json:"subject_id"`
	Requires  []requirementOut `json:"requires"`
	Unlocks   []unlockOut      `json:"unlocks"`
}

func (t *Tools) prerequisites(ctx context.Context, in subjectIn) (prerequisitesOut, error) {
	if in.SubjectID <= 0 {
		return prerequisitesOut{}, invalidArgument("subject_id must be positive")
	}
	requires, unlocks, err := t.relations(ctx, in.SubjectID)
	if err != nil {
		return prerequisitesOut{}, err
	}
	out := prerequisitesOut{SubjectID: in.SubjectID, Requires: []requirementOut{}, Unlocks: []unlockOut{}}
	for _, r := range requires {
		out.Requires = append(out.Requires, requirementOut{r.SubjectID, r.Code, r.Condition})
	}
	for _, u := range unlocks {
		out.Unlocks = append(out.Unlocks, unlockOut{u.SubjectID, u.Name})
	}
	return out, nil
}

// --- dates ---

type datesIn struct {
	CareerID int `json:"career_id" jsonschema:"career id (1 = Licenciatura en Ciencias de la Computación)"`
	Year     int `json:"year,omitempty" jsonschema:"calendar year (default: current year)"`
}

type eventOut struct {
	Kind      string  `json:"kind"`
	Title     string  `json:"title"`
	From      *string `json:"from"`
	To        *string `json:"to"`
	Notes     string  `json:"notes"`
	SourceURL string  `json:"source_url"`
}

type boardOut struct {
	Title       string `json:"title"`
	SessionKind string `json:"session_kind"`
	PDFURL      string `json:"pdf_url"`
	Notes       string `json:"notes"`
}

type datesOut struct {
	Events     []eventOut `json:"events"`
	ExamBoards []boardOut `json:"exam_boards"`
}

func (t *Tools) dates(ctx context.Context, in datesIn) (datesOut, error) {
	if in.CareerID <= 0 {
		return datesOut{}, invalidArgument("career_id must be positive")
	}
	year := in.Year
	if year == 0 {
		year = t.now().Year()
	}
	events, err := t.api.Calendar(ctx, year)
	if err != nil {
		return datesOut{}, err
	}
	boards, err := t.api.ExamBoards(ctx, in.CareerID)
	if err != nil {
		return datesOut{}, err
	}
	out := datesOut{Events: []eventOut{}, ExamBoards: []boardOut{}}
	for _, e := range events {
		out.Events = append(out.Events, eventOut{e.Kind, e.Label, e.StartsOn, e.EndsOn, e.Notes, e.SourceURL})
	}
	for _, b := range boards {
		out.ExamBoards = append(out.ExamBoards, boardOut{b.Label, b.SessionKind, b.PDFURL, b.Notes})
	}
	return out, nil
}
