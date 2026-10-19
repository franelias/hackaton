package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/spf13/cobra"

	"github.com/franelias/hackaton/backend/internal/db"
	"github.com/franelias/hackaton/backend/internal/fceia"
	"github.com/franelias/hackaton/backend/internal/plan"
	"github.com/franelias/hackaton/corrections"
)

const (
	defaultPlanFile    = "data/plan_career_1.json"
	defaultPeriodsFile = "data/periods_fceia_2026.json"
)

func importCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "import", Short: "Load data files into the database"}
	var faculty, planFile, periodsFile string

	planImport := &cobra.Command{
		Use:   "plan",
		Short: "Load a plan JSON (from `arbol plan`), replacing that career's plan",
		Args:  cobra.NoArgs,
		RunE:  func(*cobra.Command, []string) error { return importPlan(faculty, planFile) },
	}
	planImport.Flags().StringVar(&planFile, "file", defaultPlanFile, "plan JSON")

	periodsImport := &cobra.Command{
		Use:   "periods",
		Short: "Load calendar periods (recess, exam weeks), replacing the previous ones",
		Args:  cobra.NoArgs,
		RunE:  func(*cobra.Command, []string) error { return importPeriods(faculty, periodsFile) },
	}
	periodsImport.Flags().StringVar(&periodsFile, "file", defaultPeriodsFile, "periods JSON")

	cmd.PersistentFlags().StringVar(&faculty, "faculty", db.Faculty, "faculty the data belongs to")
	cmd.AddCommand(planImport, periodsImport)
	return cmd
}

func importPlan(faculty, file string) error {
	b, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	var p plan.Plan
	if err := json.Unmarshal(b, &p); err != nil {
		return err
	}
	g, err := openDB()
	if err != nil {
		return err
	}
	if err := db.ImportPlan(g, faculty, p); err != nil {
		return err
	}
	log.Printf("imported career %d (%d subjects) for %s", p.CareerID, len(p.Subjects), faculty)
	return nil
}

func importPeriods(faculty, file string) error {
	b, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	var in struct {
		Periods []struct{ Kind, Label, From, To string }
	}
	if err := json.Unmarshal(b, &in); err != nil {
		return err
	}
	var periods []db.Period
	for _, p := range in.Periods {
		from, err1 := time.Parse(time.DateOnly, p.From)
		to, err2 := time.Parse(time.DateOnly, p.To)
		if err1 != nil || err2 != nil {
			return fmt.Errorf("period %q: dates must be YYYY-MM-DD", p.Label)
		}
		periods = append(periods, db.Period{Kind: p.Kind, Label: p.Label, Starts: from, Ends: to})
	}
	g, err := openDB()
	if err != nil {
		return err
	}
	if err := db.ImportPeriods(g, faculty, periods); err != nil {
		return err
	}
	log.Printf("imported %d periods for %s", len(periods), faculty)
	return nil
}

func planCmd() *cobra.Command {
	var career int
	var overrides, out string
	cmd := &cobra.Command{
		Use:   "plan",
		Short: "Generate a career's plan JSON from the FCEIA API and the manual review",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			ov, err := corrections.For(career)
			if overrides != "" {
				var raw []byte
				if raw, err = os.ReadFile(overrides); err == nil {
					ov, err = corrections.Parse(raw)
				}
			}
			if err != nil {
				return err
			}
			res, err := plan.Generate(cmd.Context(), fceia.New(env("FCEIA_API_BASE", fceia.DefaultBase)), career, ov)
			if err != nil {
				return err
			}
			b, err := json.MarshalIndent(res.Plan, "", "  ")
			if err != nil {
				return err
			}
			b = append(b, '\n')
			if out == "-" {
				_, err := os.Stdout.Write(b)
				return err
			}
			if err := os.WriteFile(out, b, 0o644); err != nil {
				return err
			}
			log.Printf("wrote %s (%d subjects, %d cuatrimestres minimos)", out, len(res.Plan.Subjects), res.Plan.MinTerms)
			return nil
		},
	}
	cmd.Flags().IntVar(&career, "career", 1, "career_id")
	cmd.Flags().StringVar(&overrides, "overrides", "", "manual-review file to use instead of the embedded corrections/data/career_<id>.json")
	cmd.Flags().StringVar(&out, "out", defaultPlanFile, "output file ('-' for stdout)")
	return cmd
}
