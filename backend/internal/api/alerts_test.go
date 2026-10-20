package api

import (
	"encoding/json"
	"testing"

	"github.com/franelias/hackaton/backend/internal/db"
	"github.com/franelias/hackaton/backend/internal/tree"
)

func TestDiffAlerts(t *testing.T) {
	action, _ := json.Marshal(tree.Action{Type: "open_tutor"})
	stored := func(id int, key string, dismissed bool) db.Alert {
		return db.Alert{ID: id, StudentID: 1, Type: "inactivity", Level: tree.Low, Message: "m", Action: action, CondKey: key, Dismissed: dismissed}
	}
	want := []tree.Alert{{Type: "inactivity", Level: tree.Low, Message: "m", Action: tree.Action{Type: "open_tutor"}, Key: tree.Low}}

	cases := []struct {
		name                string
		rows                []db.Alert
		want                []tree.Alert
		open, save, removed int
	}{
		{"new condition is inserted", nil, want, 0, 1, 0},
		{"same condition writes nothing", []db.Alert{stored(7, tree.Low, false)}, want, 1, 0, 0},
		{"dismissed and same condition stays dismissed", []db.Alert{stored(7, tree.Low, true)}, want, 0, 0, 0},
		{"dismissed and new condition reopens", []db.Alert{stored(7, tree.Medium, true)}, want, 0, 1, 0},
		{"condition gone is removed", []db.Alert{stored(7, tree.Low, false)}, nil, 0, 0, 1},
	}
	for _, c := range cases {
		d := diffAlerts(1, c.rows, c.want)
		if len(d.open) != c.open || len(d.save) != c.save || len(d.remove) != c.removed {
			t.Errorf("%s: open %d save %d remove %d, want %d %d %d", c.name, len(d.open), len(d.save), len(d.remove), c.open, c.save, c.removed)
		}
	}
	if d := diffAlerts(1, []db.Alert{stored(7, tree.Medium, true)}, want); d.save[0].Dismissed || d.save[0].ID != 7 {
		t.Errorf("reopened alert: %+v", d.save[0])
	}
}
