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
		if err := tx.Save(&Career{Faculty: faculty, ID: p.CareerID, Name: p.Nombre, MinTerms: p.CuatrimestresMinimos, CriticalPath: p.CaminoCritico}).Error; err != nil {
			return err
		}
		var subjects []Subject
		var prereqs []Prerequisite
		for _, m := range p.Materias {
			subjects = append(subjects, Subject{
				Faculty: faculty, ID: m.SubjectID, CareerID: p.CareerID, Code: m.Code, Name: m.Nombre,
				Year: m.Anio, Term: m.Cuatrimestre, Optional: m.Opcional, Unlocks: m.Destraba,
				UnlocksTotal: m.DestrabaTotal, Bottleneck: m.CuelloDeBotella, Slack: m.Holgura,
				PostponeYearDelay: m.AtrasoPosponerAnio,
			})
			for _, r := range m.Requiere {
				prereqs = append(prereqs, Prerequisite{Faculty: faculty, SubjectID: m.SubjectID, RequiresID: r.SubjectID, Condition: r.Condicion})
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
