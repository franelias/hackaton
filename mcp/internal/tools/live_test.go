//go:build live

package tools_test

import (
	"strings"
	"testing"

	"github.com/franelias/hackaton/fceia"
)

// Run with: go test -tags live ./internal/tools
func TestLiveLogicaFlow(t *testing.T) {
	cs := connect(t, strings.TrimSuffix(fceia.DefaultBase, "/api/v1"), nil)

	subjects := ok[struct {
		Subjects []struct {
			SubjectID int `json:"subject_id"`
		} `json:"subjects"`
	}](t, cs, "search_subject", map[string]any{"name": "logica", "career_id": 1})
	if len(subjects.Subjects) != 1 {
		t.Fatalf("subjects: %+v", subjects)
	}
	id := subjects.Subjects[0].SubjectID

	freq := ok[topics](t, cs, "frequent_topics", map[string]any{"subject_id": id})
	if freq.ExamsAnalyzed == 0 || len(freq.Topics) == 0 {
		t.Fatalf("no topics: %+v", freq)
	}
	if kw := ok[keywordResult](t, cs, "frequent_topics", map[string]any{"subject_id": id}); kw.examsOf("deducción natural") < 5 {
		t.Fatalf("Lógica should keep coming back to deducción natural: %+v", kw.Keywords)
	}

	ex := ok[struct {
		Exercises []struct {
			Text    string `json:"text"`
			FileURL string `json:"file_url"`
		} `json:"exercises"`
	}](t, cs, "exercises", map[string]any{"subject_id": id, "topic": "deduccion natural"})
	if len(ex.Exercises) == 0 || ex.Exercises[0].Text == "" || !strings.HasPrefix(ex.Exercises[0].FileURL, "https://") {
		t.Fatalf("exercises: %+v", ex)
	}
}

func TestLiveBuildScheduleFindsTheLogicaAlgebraLinealClash(t *testing.T) {
	cs := connect(t, strings.TrimSuffix(fceia.DefaultBase, "/api/v1"), nil)

	got := ok[schedResult](t, cs, "build_schedule", map[string]any{"subject_ids": []int{7, 12}})

	if len(got.Conflicts) == 0 || len(got.Postpone) != 1 || len(got.Options) == 0 {
		t.Fatalf("unexpected result: %+v", got)
	}
}
