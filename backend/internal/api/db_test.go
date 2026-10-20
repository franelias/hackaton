package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"firebase.google.com/go/v4/auth"

	"github.com/franelias/hackaton/backend/internal/db"
	"github.com/franelias/hackaton/backend/internal/db/dbtest"
	"github.com/franelias/hackaton/fceia"
	"github.com/franelias/hackaton/fceia/tools"
)

// fakeVerifier accepts any token as the user "u", with a verified email.
type fakeVerifier struct{}

func (fakeVerifier) VerifyIDToken(context.Context, string) (*auth.Token, error) {
	return &auth.Token{UID: "u", Claims: map[string]any{"email": "docente@arbol.test", "email_verified": true}}, nil
}

// testServer is a Server on an empty database with one career of three
// subjects (12 requires 11) and the student s-001.
func testServer(t *testing.T) (*Server, *db.Student, *time.Time) {
	t.Helper()
	g := dbtest.New(t)
	now := time.Date(2026, 10, 14, 15, 0, 0, 0, time.UTC)
	if err := g.Create(&db.Career{Faculty: db.Faculty, ID: 1, Name: "Lic. Test", MinTerms: 1, CriticalPath: []int{}}).Error; err != nil {
		t.Fatal(err)
	}
	subjects := []db.Subject{
		{Faculty: db.Faculty, ID: 11, CareerID: 1, Code: "A", Name: "Análisis I", Unlocks: []int{12}},
		{Faculty: db.Faculty, ID: 12, CareerID: 1, Code: "B", Name: "Análisis II", Unlocks: []int{}},
		{Faculty: db.Faculty, ID: 13, CareerID: 1, Code: "C", Name: "Lógica", Unlocks: []int{}},
	}
	if err := g.Create(&subjects).Error; err != nil {
		t.Fatal(err)
	}
	if err := g.Create(&db.Prerequisite{Faculty: db.Faculty, SubjectID: 12, RequiresID: 11, Condition: "approved"}).Error; err != nil {
		t.Fatal(err)
	}
	st := db.Student{FirebaseUID: "u", Name: "Ana", Faculty: db.Faculty, CareerID: 1, CreatedAt: now.AddDate(0, 0, -30)}
	if err := g.Create(&st).Error; err != nil {
		t.Fatal(err)
	}
	s := &Server{DB: g, Auth: fakeVerifier{}, Now: func() time.Time { return now }, FCEIA: tools.New(fceia.New("http://invalid.test"), nil)}
	return s, &st, &now
}

func call(t *testing.T, h http.Handler, method, path, body string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer x")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code, rec.Body.String()
}

func TestTreeAndAlertsOverTheDatabase(t *testing.T) {
	s, st, now := testServer(t)
	h := s.Routes()
	base := "/api/students/" + formatStudentID(st.ID)

	if code, body := call(t, h, "PUT", base+"/subjects", `{"subjects":[{"subject_id":11,"state":"enrolled"}]}`); code != 200 {
		t.Fatalf("put subjects: %d %s", code, body)
	}
	// two chat messages the same day make one study week
	s.DB.Create(&[]db.Activity{{StudentID: st.ID, Type: "chat", CreatedAt: *now}, {StudentID: st.ID, Type: "chat", CreatedAt: now.Add(time.Hour)}})

	code, body := call(t, h, "GET", base+"/tree", "")
	if code != 200 {
		t.Fatalf("tree: %d %s", code, body)
	}
	var tr struct {
		Streak   struct{ Weeks int }
		Subjects []struct {
			SubjectID int `json:"subject_id"`
			State     string
		}
	}
	if err := json.Unmarshal([]byte(body), &tr); err != nil || tr.Streak.Weeks != 1 || len(tr.Subjects) == 0 {
		t.Fatalf("tree = %s (%v)", body, err)
	}
	if code, body := call(t, h, "GET", base+"/alerts", ""); code != 200 {
		t.Fatalf("alerts: %d %s", code, body)
	}
	var stored int64
	s.DB.Model(&db.Alert{}).Where("student_id = ?", st.ID).Count(&stored)
	if code, _ := call(t, h, "GET", base+"/tree", ""); code != 200 {
		t.Fatal("second tree")
	}
	var again int64
	s.DB.Model(&db.Alert{}).Where("student_id = ?", st.ID).Count(&again)
	if again != stored {
		t.Errorf("alerts rows %d then %d: a read must not duplicate them", stored, again)
	}
}

func TestViewTreeUsesTheInputItBuilt(t *testing.T) {
	s, st, _ := testServer(t)
	s.DB.Create(&db.StudentSubject{StudentID: st.ID, SubjectID: 11, State: "enrolled", Since: st.CreatedAt})
	topic, subject := "límites", 11
	for _, correct := range []string{"true", "true", "false"} {
		s.DB.Create(&db.Activity{StudentID: st.ID, Type: "exercise", SubjectID: &subject, Topic: &topic, Result: json.RawMessage(`{"correct":` + correct + `}`)})
	}
	out, isErr := s.viewTree(st)
	if isErr {
		t.Fatal(out)
	}
	var v struct {
		Subjects []struct {
			SubjectID int `json:"subject_id"`
			Name      string
			Topics    []struct {
				Topic    string
				Correct  int
				Attempts int
			}
		}
	}
	if err := json.Unmarshal([]byte(out), &v); err != nil {
		t.Fatal(err, out)
	}
	for _, x := range v.Subjects {
		if x.SubjectID == 11 {
			if x.Name != "Análisis I" || len(x.Topics) != 1 || x.Topics[0].Correct != 2 || x.Topics[0].Attempts != 3 {
				t.Errorf("subject 11 = %+v, want its name and 2/3 on límites", x)
			}
			return
		}
	}
	t.Errorf("subject 11 not in %s", out)
}

func TestLoadHistoryKeepsTheTail(t *testing.T) {
	s, st, _ := testServer(t)
	conv := db.Conversation{StudentID: st.ID}
	s.DB.Create(&conv)
	roles := []string{"user", "assistant", "tool", "assistant"}
	var all []db.ConversationMessage
	for i := range 130 {
		all = append(all, db.ConversationMessage{ConversationID: conv.ID, Role: roles[i%len(roles)], Content: json.RawMessage(fmt.Sprintf(`{"i":%d}`, i))})
	}
	// another conversation's messages must not leak in
	other := db.Conversation{StudentID: st.ID}
	s.DB.Create(&other)
	s.DB.Create(&db.ConversationMessage{ConversationID: other.ID, Role: "user", Content: json.RawMessage(`{}`)})
	s.DB.Create(&all)

	got, err := loadHistory(s.DB, conv.ID)
	if err != nil {
		t.Fatal(err)
	}
	var every []db.ConversationMessage
	s.DB.Order("id").Find(&every, "conversation_id = ?", conv.ID)
	want := recent(every, maxHistory)
	if len(got) != len(want) || len(got) == 0 || got[0].Role != "user" {
		t.Fatalf("got %d messages starting with %q, want %d", len(got), got[0].Role, len(want))
	}
	for i := range got {
		if got[i].ID != want[i].ID {
			t.Fatalf("message %d is %d, want %d", i, got[i].ID, want[i].ID)
		}
	}

	// a short conversation comes back whole
	short := db.Conversation{StudentID: st.ID}
	s.DB.Create(&short)
	s.DB.Create(&[]db.ConversationMessage{
		{ConversationID: short.ID, Role: "user", Content: json.RawMessage(`{}`)},
		{ConversationID: short.ID, Role: "assistant", Content: json.RawMessage(`{}`)},
	})
	if got, _ := loadHistory(s.DB, short.ID); len(got) != 2 || got[0].Role != "user" {
		t.Errorf("short conversation = %d messages", len(got))
	}
}

func TestMCPTokenLastUsedIsThrottled(t *testing.T) {
	s, st, now := testServer(t)
	h := s.Routes()
	code, body := call(t, h, "POST", "/api/students/"+formatStudentID(st.ID)+"/mcp-token", "")
	if code != http.StatusCreated {
		t.Fatalf("token: %d %s", code, body)
	}
	var tok struct{ Token string }
	json.Unmarshal([]byte(body), &tok)

	use := func() {
		req := httptest.NewRequest("POST", "/mcp", strings.NewReader("{}"))
		req.Header.Set("Authorization", "Bearer "+tok.Token)
		h.ServeHTTP(httptest.NewRecorder(), req)
	}
	lastUsed := func() *time.Time {
		var row db.MCPToken
		s.DB.First(&row, "student_id = ?", st.ID)
		return row.LastUsedAt
	}

	use()
	first := lastUsed()
	if first == nil || !first.Equal(*now) {
		t.Fatalf("first use: last_used_at = %v, want %v", first, *now)
	}
	*now = now.Add(time.Minute)
	use()
	if got := lastUsed(); !got.Equal(*first) {
		t.Errorf("a second use a minute later wrote last_used_at: %v", got)
	}
	*now = now.Add(mcpTouchEvery)
	use()
	if got := lastUsed(); !got.Equal(*now) {
		t.Errorf("a use after %v did not refresh last_used_at: %v, want %v", mcpTouchEvery, got, *now)
	}
	// a revoked token is refused
	call(t, h, "DELETE", "/api/students/"+formatStudentID(st.ID)+"/mcp-token", "")
	req := httptest.NewRequest("POST", "/mcp", strings.NewReader("{}"))
	req.Header.Set("Authorization", "Bearer "+tok.Token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("revoked token: %d", rec.Code)
	}
}

func TestTeacherViewOverTheDatabase(t *testing.T) {
	s, st, now := testServer(t)
	teacher := db.Teacher{Email: "docente@arbol.test", Name: "Laura"}
	s.DB.Create(&teacher)
	s.DB.Create(&db.TeacherSubject{TeacherID: teacher.ID, Faculty: db.Faculty, SubjectID: 11})
	classmate := db.Student{FirebaseUID: "seed:b", Name: "Beto", Faculty: db.Faculty, CareerID: 1, CreatedAt: now.AddDate(0, 0, -30)}
	s.DB.Create(&classmate)
	topic, subject := "límites", 11
	for _, id := range []int{st.ID, classmate.ID} {
		s.DB.Create(&db.StudentSubject{StudentID: id, SubjectID: 11, State: "enrolled", Since: now.AddDate(0, 0, -5)})
	}
	s.DB.Create(&[]db.Activity{
		{StudentID: st.ID, Type: "exercise", SubjectID: &subject, Topic: &topic, Result: json.RawMessage(`{"correct":true}`), CreatedAt: now.Add(-time.Hour)},
		{StudentID: st.ID, Type: "chat", CreatedAt: now.Add(-time.Hour)},
		{StudentID: st.ID, Type: "chat", CreatedAt: now.Add(-2 * time.Hour)},
	})

	code, body := call(t, s.Routes(), "GET", "/api/teacher/subjects/11", "")
	if code != 200 {
		t.Fatalf("teacher subject: %d %s", code, body)
	}
	var v struct {
		Students []struct {
			StudentID string `json:"student_id"`
		}
		Summary struct{ Students int }
	}
	if err := json.Unmarshal([]byte(body), &v); err != nil || len(v.Students) != 2 {
		t.Fatalf("students = %s (%v)", body, err)
	}
	if code, body := call(t, s.Routes(), "GET", "/api/teacher", ""); code != 200 {
		t.Fatalf("teacher home: %d %s", code, body)
	}
}
