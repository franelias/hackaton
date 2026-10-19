package tools_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/franelias/hackaton/mcp/internal/fceia"
	"github.com/franelias/hackaton/mcp/internal/tools"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const emptyPage = `{"items":[],"total":0,"limit":100,"offset":0}`

// stubAPI serves recorded FCEIA responses. Routes map "path?sorted-query" to a
// file in testdata/ (or inline JSON when the value starts with "{").
// Unknown routes answer 404 like the real API.
func stubAPI(t *testing.T, routes map[string]string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := strings.TrimPrefix(r.URL.Path, "/api/v1")
		if q := r.URL.Query().Encode(); q != "" {
			key += "?" + q
		}
		body, ok := routes[key]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte(`{"detail":"not found"}`))
			return
		}
		if !strings.HasPrefix(body, "{") {
			b, err := os.ReadFile(filepath.Join("testdata", body))
			if err != nil {
				t.Errorf("fixture %s: %v", body, err)
			}
			body = string(b)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func connect(t *testing.T, apiURL string, now func() time.Time) *mcp.ClientSession {
	t.Helper()
	server := tools.NewServer(fceia.New(apiURL+"/api/v1"), now)
	ct, st := mcp.NewInMemoryTransports()
	ctx := context.Background()
	ss, err := server.Connect(ctx, st, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ss.Close() })
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "test"}, nil).Connect(ctx, ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cs.Close() })
	return cs
}

func call(t *testing.T, cs *mcp.ClientSession, name string, args map[string]any) *mcp.CallToolResult {
	t.Helper()
	res, err := cs.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return res
}

func ok[T any](t *testing.T, cs *mcp.ClientSession, name string, args map[string]any) T {
	t.Helper()
	res := call(t, cs, name, args)
	if res.IsError {
		t.Fatalf("%s returned a tool error: %s", name, res.Content[0].(*mcp.TextContent).Text)
	}
	raw, err := json.Marshal(res.StructuredContent)
	if err != nil {
		t.Fatal(err)
	}
	var out T
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

type errBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func fails(t *testing.T, cs *mcp.ClientSession, name string, args map[string]any) errBody {
	t.Helper()
	res := call(t, cs, name, args)
	if !res.IsError {
		t.Fatalf("%s should have failed", name)
	}
	var e errBody
	if err := json.Unmarshal([]byte(res.Content[0].(*mcp.TextContent).Text), &e); err != nil {
		t.Fatalf("error is not the contract JSON: %v", err)
	}
	return e
}

const subject12Exams = "/exams?limit=100&offset=0&subject_id=12"

func TestSearchSubjectFindsLogicaWithoutAccents(t *testing.T) {
	t.Parallel()
	api := stubAPI(t, map[string]string{
		"/subjects?career_id=1&limit=100&offset=0&q=logica": "subjects_logica.json",
	})
	cs := connect(t, api.URL, nil)

	got := ok[struct {
		Subjects []struct {
			SubjectID int    `json:"subject_id"`
			Code      string `json:"code"`
			Name      string `json:"name"`
		} `json:"subjects"`
	}](t, cs, "search_subject", map[string]any{"name": "logica", "career_id": 1})

	if len(got.Subjects) != 1 || got.Subjects[0].SubjectID != 12 || got.Subjects[0].Name != "Lógica" || got.Subjects[0].Code != "r223" {
		t.Fatalf("unexpected subjects: %+v", got.Subjects)
	}
}

func TestSearchSubjectRejectsEmptyName(t *testing.T) {
	t.Parallel()
	cs := connect(t, stubAPI(t, nil).URL, nil)

	if e := fails(t, cs, "search_subject", map[string]any{"name": "  "}); e.Error.Code != "invalid_argument" {
		t.Fatalf("code = %q", e.Error.Code)
	}
}

type topics struct {
	ExamsAnalyzed int `json:"exams_analyzed"`
	Undated       int `json:"undated"`
	Topics        []struct {
		Topic    string `json:"topic"`
		Count    int    `json:"count"`
		LastYear int    `json:"last_year"`
	} `json:"topics"`
}

const subject99Exams = "/exams?limit=100&offset=0&subject_id=99"

func TestFrequentTopicsMergesAccentCaseAndParenthesisVariants(t *testing.T) {
	t.Parallel()
	api := stubAPI(t, map[string]string{subject99Exams: "exams_subject99_topic_variants.json"})
	cs := connect(t, api.URL, nil)

	got := ok[topics](t, cs, "frequent_topics", map[string]any{"subject_id": 99})

	if got.ExamsAnalyzed != 3 || got.Undated != 1 || len(got.Topics) != 2 {
		t.Fatalf("unexpected summary: %+v", got)
	}
	first, second := got.Topics[0], got.Topics[1]
	if first.Topic != "modelo entidad/relación (DER)" || first.Count != 3 || first.LastYear != 2022 {
		t.Fatalf("first topic: %+v", first)
	}
	if second.Topic != "paso a tablas" || second.Count != 2 {
		t.Fatalf("second topic: %+v", second)
	}
}

func TestFrequentTopicsSinceDropsOlderExamsButKeepsUndatedOnes(t *testing.T) {
	t.Parallel()
	api := stubAPI(t, map[string]string{subject99Exams: "exams_subject99_topic_variants.json"})
	cs := connect(t, api.URL, nil)

	got := ok[topics](t, cs, "frequent_topics", map[string]any{"subject_id": 99, "since": 2021})

	if got.ExamsAnalyzed != 2 || got.Undated != 1 {
		t.Fatalf("unexpected summary: %+v", got)
	}
}

func TestExercisesMatchTopicIgnoringAccentsNewestFirst(t *testing.T) {
	t.Parallel()
	api := stubAPI(t, map[string]string{subject12Exams: "exams_subject12.json"})
	cs := connect(t, api.URL, nil)

	got := ok[struct {
		Exercises []struct {
			ExamID int `json:"exam_id"`
		} `json:"exercises"`
	}](t, cs, "exercises", map[string]any{"subject_id": 12, "topic": "DEDUCCION natural", "limit": 3})

	var ids []int
	for _, e := range got.Exercises {
		ids = append(ids, e.ExamID)
	}
	if len(ids) != 3 || ids[0] != 824 || ids[1] != 823 || ids[2] != 829 {
		t.Fatalf("exam ids = %v, want [824 823 829]", ids)
	}
}

func TestExercisesRestrictToRequestedCategory(t *testing.T) {
	t.Parallel()
	api := stubAPI(t, map[string]string{
		"/exams?category=parcial&limit=100&offset=0&subject_id=12": "exams_subject12_parcial.json",
	})
	cs := connect(t, api.URL, nil)

	got := ok[struct {
		Exercises []struct {
			Category string `json:"category"`
		} `json:"exercises"`
	}](t, cs, "exercises", map[string]any{"subject_id": 12, "category": "parcial", "limit": 10})

	if len(got.Exercises) != 9 || got.Exercises[0].Category != "parcial" {
		t.Fatalf("got %d exercises: %+v", len(got.Exercises), got.Exercises)
	}
}

func TestExercisesReturnTextAbsoluteFileURLAndScannedFlag(t *testing.T) {
	t.Parallel()
	api := stubAPI(t, map[string]string{
		"/exams?limit=100&offset=0&subject_id=23": "exams_subject23.json",
		"/exams/929/text":                         "exam929_text.json",
	})
	cs := connect(t, api.URL, nil)

	got := ok[struct {
		Exercises []struct {
			Text        string `json:"text"`
			FileURL     string `json:"file_url"`
			Scanned     bool   `json:"scanned"`
			HasSolution bool   `json:"has_solution"`
		} `json:"exercises"`
	}](t, cs, "exercises", map[string]any{"subject_id": 23})

	e := got.Exercises[0]
	wantURL := api.URL + "/media/examenes/lcc/Sistemas%20Operativos%202/exa%CC%81menes%20parciales/1er%20parcial%20-%202026.pdf"
	if e.FileURL != wantURL {
		t.Fatalf("file_url = %q, want %q", e.FileURL, wantURL)
	}
	if !e.Scanned || e.HasSolution || !strings.HasPrefix(e.Text, "**Examen parcial**") {
		t.Fatalf("unexpected exercise: scanned=%v solution=%v text=%.30q", e.Scanned, e.HasSolution, e.Text)
	}
}

func TestExercisesRejectUnknownCategory(t *testing.T) {
	t.Parallel()
	cs := connect(t, stubAPI(t, nil).URL, nil)

	if e := fails(t, cs, "exercises", map[string]any{"subject_id": 12, "category": "oral"}); e.Error.Code != "invalid_argument" {
		t.Fatalf("code = %q", e.Error.Code)
	}
}

type solution struct {
	ExamID    int    `json:"exam_id"`
	Available bool   `json:"available"`
	Text      string `json:"text"`
}

func TestSolutionReturnsOfficialTextWhenExamHasOne(t *testing.T) {
	t.Parallel()
	api := stubAPI(t, map[string]string{
		"/exams/399":          "exam399.json",
		"/solutions/401/text": "solution401_text.json",
	})
	cs := connect(t, api.URL, nil)

	got := ok[solution](t, cs, "solution", map[string]any{"exam_id": 399})

	if !got.Available || !strings.Contains(got.Text, "INTRODUCCIÓNALAMATEMÁTICA") {
		t.Fatalf("unexpected solution: available=%v text=%.40q", got.Available, got.Text)
	}
}

func TestSolutionIsUnavailableWhenExamHasNone(t *testing.T) {
	t.Parallel()
	api := stubAPI(t, map[string]string{"/exams/929": "exam929.json"})
	cs := connect(t, api.URL, nil)

	got := ok[solution](t, cs, "solution", map[string]any{"exam_id": 929})

	if got.Available || got.Text != "" || got.ExamID != 929 {
		t.Fatalf("unexpected solution: %+v", got)
	}
}

func TestSolutionOfUnknownExamIsNotFound(t *testing.T) {
	t.Parallel()
	cs := connect(t, stubAPI(t, nil).URL, nil)

	if e := fails(t, cs, "solution", map[string]any{"exam_id": 999999}); e.Error.Code != "not_found" {
		t.Fatalf("code = %q", e.Error.Code)
	}
}

type materials struct {
	Materials []struct {
		MaterialID int    `json:"material_id"`
		Snippet    string `json:"snippet"`
		URL        string `json:"url"`
	} `json:"materials"`
}

func TestSearchMaterialsReturnsSnippetAroundMatchAndAbsoluteURL(t *testing.T) {
	t.Parallel()
	api := stubAPI(t, map[string]string{
		"/materials?limit=100&offset=0&subject_id=6&text=fopen": "materials_s6_fopen.json",
		"/materials?limit=100&offset=0&subject_id=6&text=Fopen": emptyPage,
		"/materials/3016/text": "material3016_text.json",
	})
	cs := connect(t, api.URL, nil)

	got := ok[materials](t, cs, "search_materials", map[string]any{"subject_id": 6, "topic": "fopen", "limit": 1})

	m := got.Materials[0]
	if m.MaterialID != 3016 || !strings.Contains(m.Snippet, "fopen") || utf8.RuneCountInString(m.Snippet) > 1502 {
		t.Fatalf("unexpected material: id=%d snippet=%.60q", m.MaterialID, m.Snippet)
	}
	if m.URL != api.URL+"/media/materiales/lcc/Archivos_en_C.pdf.pdf" {
		t.Fatalf("url = %q", m.URL)
	}
}

func TestSearchMaterialsFindsMaterialOnlyMatchedByCapitalizedSpelling(t *testing.T) {
	t.Parallel()
	api := stubAPI(t, map[string]string{
		"/materials?limit=100&offset=0&subject_id=6&text=fopen": emptyPage,
		"/materials?limit=100&offset=0&subject_id=6&text=Fopen": "materials_s6_fopen.json",
		"/materials/3016/text": "material3016_text.json",
	})
	cs := connect(t, api.URL, nil)

	got := ok[materials](t, cs, "search_materials", map[string]any{"subject_id": 6, "topic": "fopen", "limit": 1})

	if len(got.Materials) != 1 || got.Materials[0].MaterialID != 3016 {
		t.Fatalf("unexpected materials: %+v", got.Materials)
	}
}

func TestBibliographyListsBooksWithISBN(t *testing.T) {
	t.Parallel()
	api := stubAPI(t, map[string]string{"/subjects/6/bibliography?limit=100&offset=0": "bibliography_s6.json"})
	cs := connect(t, api.URL, nil)

	got := ok[struct {
		Books []struct {
			Title  string `json:"title"`
			Author string `json:"author"`
			ISBN   string `json:"isbn"`
		} `json:"books"`
	}](t, cs, "bibliography", map[string]any{"subject_id": 6})

	if len(got.Books) != 4 || got.Books[0].Title != "Programación en C" || got.Books[0].ISBN != "9781548817701" {
		t.Fatalf("unexpected books: %+v", got.Books)
	}
}

func TestPrerequisitesTreatNullRequirementAsApproved(t *testing.T) {
	t.Parallel()
	api := stubAPI(t, map[string]string{
		"/subjects/55":           "subject55.json",
		"/subjects/55/relations": "relations_s55.json",
	})
	cs := connect(t, api.URL, nil)

	got := ok[struct {
		Requires []struct {
			SubjectID int    `json:"subject_id"`
			Code      string `json:"code"`
			Condition string `json:"condition"`
		} `json:"requires"`
		Unlocks []struct {
			Name string `json:"name"`
		} `json:"unlocks"`
	}](t, cs, "prerequisites", map[string]any{"subject_id": 55})

	if len(got.Requires) != 2 ||
		got.Requires[0].Code != "FB2" || got.Requires[0].Condition != "approved" ||
		got.Requires[1].Code != "FB3" || got.Requires[1].Condition != "regular" {
		t.Fatalf("unexpected requires: %+v", got.Requires)
	}
	if len(got.Unlocks) == 0 || got.Unlocks[0].Name != "Cálculo III" {
		t.Fatalf("unexpected unlocks: %+v", got.Unlocks)
	}
}

func TestPrerequisitesOfUnknownSubjectAreNotFound(t *testing.T) {
	t.Parallel()
	cs := connect(t, stubAPI(t, nil).URL, nil)

	if e := fails(t, cs, "prerequisites", map[string]any{"subject_id": 999999}); e.Error.Code != "not_found" {
		t.Fatalf("code = %q", e.Error.Code)
	}
}

func TestDatesKeepEventsWithoutDatesAndDefaultToTheCurrentYear(t *testing.T) {
	t.Parallel()
	api := stubAPI(t, map[string]string{
		"/calendar?limit=100&offset=0&year=2026":      "calendar_2026.json",
		"/exam-boards?career_id=1&limit=100&offset=0": "boards_c1.json",
	})
	now := func() time.Time { return time.Date(2026, 10, 19, 0, 0, 0, 0, time.UTC) }
	cs := connect(t, api.URL, now)

	got := ok[struct {
		Events []struct {
			Title string  `json:"title"`
			From  *string `json:"from"`
		} `json:"events"`
		ExamBoards []struct {
			Title  string `json:"title"`
			PDFURL string `json:"pdf_url"`
		} `json:"exam_boards"`
	}](t, cs, "dates", map[string]any{"career_id": 1})

	if len(got.Events) != 2 || got.Events[0].From != nil || !strings.HasPrefix(got.Events[0].Title, "Calendario Académico 2026") {
		t.Fatalf("unexpected events: %+v", got.Events)
	}
	if len(got.ExamBoards) != 1 || !strings.HasSuffix(got.ExamBoards[0].PDFURL, "/lcc.pdf") {
		t.Fatalf("unexpected boards: %+v", got.ExamBoards)
	}
}

func TestAPIFailureIsReportedAsAPIUnavailable(t *testing.T) {
	t.Parallel()
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "boom", http.StatusBadGateway)
	}))
	t.Cleanup(down.Close)
	cs := connect(t, down.URL, nil)

	if e := fails(t, cs, "bibliography", map[string]any{"subject_id": 6}); e.Error.Code != "api_unavailable" {
		t.Fatalf("code = %q", e.Error.Code)
	}
}

func TestToolsAreListedWithEnglishNames(t *testing.T) {
	t.Parallel()
	cs := connect(t, stubAPI(t, nil).URL, nil)

	res, err := cs.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, tool := range res.Tools {
		names = append(names, tool.Name)
	}
	want := "bibliography build_schedule dates exercises frequent_topics prerequisites search_materials search_subject solution"
	if got := sortedJoin(names); got != want {
		t.Fatalf("tools = %q, want %q", got, want)
	}
}

type keywordResult struct {
	Keywords []struct {
		Keyword  string `json:"keyword"`
		Exams    int    `json:"exams"`
		LastYear int    `json:"last_year"`
	} `json:"keywords"`
}

func (k keywordResult) examsOf(keyword string) int {
	for _, kw := range k.Keywords {
		if kw.Keyword == keyword {
			return kw.Exams
		}
	}
	return 0
}

func TestKeywordsShowWhatKeepsComingUpInASubjectWithFewExams(t *testing.T) {
	t.Parallel()
	// Lógica has 10 exams and 40 different free-text topics, 36 of them once.
	api := stubAPI(t, map[string]string{subject12Exams: "exams_subject12.json"})
	cs := connect(t, api.URL, nil)

	got := ok[keywordResult](t, cs, "frequent_topics", map[string]any{"subject_id": 12})

	want := map[string]int{"deducción natural": 7, "consecuencia semántica": 6, "secuentes": 4, "consistencia": 4}
	for keyword, exams := range want {
		if got.examsOf(keyword) != exams {
			t.Errorf("%q in %d exams, want %d", keyword, got.examsOf(keyword), exams)
		}
	}
	if got.Keywords[0].Keyword != "semántica" || got.Keywords[0].Exams != 9 || got.Keywords[0].LastYear != 2022 {
		t.Fatalf("top keyword: %+v", got.Keywords[0])
	}
}

func TestKeywordsDropAWordThatOnlyAppearsInsideAnEquallyFrequentPair(t *testing.T) {
	t.Parallel()
	api := stubAPI(t, map[string]string{subject12Exams: "exams_subject12.json"})
	cs := connect(t, api.URL, nil)

	got := ok[keywordResult](t, cs, "frequent_topics", map[string]any{"subject_id": 12})

	// "deducción natural" is in 7 exams; so are "deducción" and "natural" alone.
	if got.examsOf("deducción") != 0 || got.examsOf("natural") != 0 {
		t.Fatalf("redundant single words were kept: %+v", got.Keywords)
	}
	// "semántica" is in 9 exams but "consecuencia semántica" only in 6: it stays.
	if got.examsOf("semántica") != 9 {
		t.Fatalf("semántica = %d", got.examsOf("semántica"))
	}
}

func TestKeywordsMergeAccentsAndIgnoreShortWordsAndStopwords(t *testing.T) {
	t.Parallel()
	api := stubAPI(t, map[string]string{subject99Exams: "exams_subject99_topic_variants.json"})
	cs := connect(t, api.URL, nil)

	got := ok[keywordResult](t, cs, "frequent_topics", map[string]any{"subject_id": 99})

	var shown []string
	for _, kw := range got.Keywords {
		shown = append(shown, kw.Keyword+"="+strconv.Itoa(kw.Exams))
	}
	// "DER" is too short, "a" is a stopword, and "relación"/"relacion" count as one.
	want := []string{"entidad relación=3", "modelo entidad=3", "paso=2", "tablas=2"}
	if !reflect.DeepEqual(shown, want) {
		t.Fatalf("keywords = %v, want %v", shown, want)
	}
}

func TestKeywordsAreEmptyWhenNoWordRepeats(t *testing.T) {
	t.Parallel()
	api := stubAPI(t, map[string]string{
		"/exams?limit=100&offset=0&subject_id=23": "exams_subject23.json",
	})
	cs := connect(t, api.URL, nil)

	got := ok[keywordResult](t, cs, "frequent_topics", map[string]any{"subject_id": 23})

	if len(got.Keywords) != 0 {
		t.Fatalf("a single exam cannot repeat anything: %+v", got.Keywords)
	}
}

func TestKeywordsSkipStopwordsEvenWhenTheyRepeat(t *testing.T) {
	t.Parallel()
	api := stubAPI(t, map[string]string{"/exams?limit=100&offset=0&subject_id=98": "exams_subject98_stopwords.json"})
	cs := connect(t, api.URL, nil)

	got := ok[keywordResult](t, cs, "frequent_topics", map[string]any{"subject_id": 98})

	var shown []string
	for _, kw := range got.Keywords {
		shown = append(shown, kw.Keyword)
	}
	// "sobre" and "entre" repeat in both exams but are not topics, and they
	// do not glue their neighbours into pairs.
	if want := []string{"análisis", "cálculo", "modelos", "sistemas"}; !reflect.DeepEqual(shown, want) {
		t.Fatalf("keywords = %v, want %v", shown, want)
	}
}
