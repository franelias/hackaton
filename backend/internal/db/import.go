package db

import (
	"github.com/franelias/hackaton/backend/internal/plan"
	"gorm.io/gorm"
)

// ImportPlan replaces a career's plan (contract §2.1) with p, in one transaction.
func ImportPlan(g *gorm.DB, faculty string, p plan.Plan) error {
	return g.Transaction(func(tx *gorm.DB) error {
		// The career row stays (students reference it); its subjects are replaced
		// and their prerequisites go with them (ON DELETE CASCADE).
		if err := tx.Where("faculty = ? AND career_id = ?", faculty, p.CareerID).Delete(&Subject{}).Error; err != nil {
			return err
		}
		if err := tx.Save(&Career{Faculty: faculty, ID: p.CareerID, Name: p.Name, MinTerms: p.MinTerms, CriticalPath: p.CriticalPath, FinalGoal: p.FinalGoal}).Error; err != nil {
			return err
		}
		var subjects []Subject
		var prereqs []Prerequisite
		for _, m := range p.Subjects {
			subjects = append(subjects, Subject{
				Faculty: faculty, ID: m.SubjectID, CareerID: p.CareerID, Code: m.Code, Name: m.Name,
				Year: m.Year, Term: m.Term, Optional: m.Optional, Unlocks: m.Unlocks,
				UnlocksTotal: m.UnlocksTotal, Bottleneck: m.Bottleneck, Slack: m.Slack,
				PostponeYearDelay: m.PostponeYearDelay,
			})
			for _, r := range m.Requires {
				prereqs = append(prereqs, Prerequisite{Faculty: faculty, SubjectID: m.SubjectID, RequiresID: r.SubjectID, Condition: r.Condition})
			}
		}
		if err := tx.Create(&subjects).Error; err != nil {
			return err
		}
		if len(prereqs) == 0 {
			return nil
		}
		return tx.Create(&prereqs).Error
	})
}

// ImportPeriods replaces a faculty's calendar periods (recess, exams).
func ImportPeriods(g *gorm.DB, faculty string, periods []Period) error {
	return g.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("faculty = ?", faculty).Delete(&Period{}).Error; err != nil {
			return err
		}
		for i := range periods {
			periods[i].Faculty = faculty
		}
		return tx.Create(&periods).Error
	})
}
