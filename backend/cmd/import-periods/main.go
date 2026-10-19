// Command import-periods loads a faculty's calendar periods (recess and exam
// weeks) from JSON into the database, replacing the previous ones.
package main

import (
	"encoding/json"
	"flag"
	"log"
	"os"
	"time"

	"github.com/franelias/hackaton/backend/internal/db"
)

func main() {
	faculty := flag.String("faculty", db.Faculty, "faculty the periods belong to")
	file := flag.String("file", "data/periods_fceia_2026.json", "periods JSON")
	flag.Parse()

	b, err := os.ReadFile(*file)
	if err != nil {
		log.Fatal(err)
	}
	var in struct {
		Periods []struct{ Kind, Label, From, To string }
	}
	if err := json.Unmarshal(b, &in); err != nil {
		log.Fatal(err)
	}
	var periods []db.Period
	for _, p := range in.Periods {
		from, err1 := time.Parse(time.DateOnly, p.From)
		to, err2 := time.Parse(time.DateOnly, p.To)
		if err1 != nil || err2 != nil {
			log.Fatalf("period %q: dates must be YYYY-MM-DD", p.Label)
		}
		periods = append(periods, db.Period{Kind: p.Kind, Label: p.Label, Starts: from, Ends: to})
	}
	g, err := db.Open(os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	if err := db.ImportPeriods(g, *faculty, periods); err != nil {
		log.Fatal(err)
	}
	log.Printf("imported %d periods for %s", len(periods), *faculty)
}
