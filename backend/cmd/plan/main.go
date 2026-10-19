// Command plan generates a career's plan tree (docs/contratos.md §2.1) from
// the FCEIA API and the manual-review overrides, and writes it as JSON.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"
	"os/signal"

	"github.com/franelias/hackaton/backend/internal/fceia"
	"github.com/franelias/hackaton/backend/internal/plan"
	"github.com/franelias/hackaton/corrections"
)

func main() {
	career := flag.Int("career", 1, "career_id")
	overrides := flag.String("overrides", "", "manual-review file to use instead of the embedded corrections/data/career_<id>.json")
	out := flag.String("out", "data/plan_career_1.json", "output file ('-' for stdout)")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	base := os.Getenv("FCEIA_API_BASE")
	if base == "" {
		base = fceia.DefaultBase
	}
	ov, err := corrections.For(*career)
	if *overrides != "" {
		var raw []byte
		if raw, err = os.ReadFile(*overrides); err == nil {
			ov, err = corrections.Parse(raw)
		}
	}
	if err != nil {
		log.Fatal(err)
	}
	res, err := plan.Generate(ctx, fceia.New(base), *career, ov)
	if err != nil {
		log.Fatal(err)
	}
	b, err := json.MarshalIndent(res.Plan, "", "  ")
	if err != nil {
		log.Fatal(err)
	}
	b = append(b, '\n')
	if *out == "-" {
		os.Stdout.Write(b)
		return
	}
	if err := os.WriteFile(*out, b, 0o644); err != nil {
		log.Fatal(err)
	}
	log.Printf("wrote %s (%d subjects, %d cuatrimestres minimos)", *out, len(res.Plan.Subjects), res.Plan.MinTerms)
}
