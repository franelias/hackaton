package main

import (
	"fmt"
	"log"
	"strings"

	"github.com/spf13/cobra"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/franelias/hackaton/backend/internal/db"
)

func teacherCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "teacher", Short: "Manage the teachers (docs/contratos.md §2.6)"}
	var email, name, faculty string
	var subjects []int
	add := &cobra.Command{
		Use:   "add",
		Short: "Create or update a teacher and replace the subjects they teach",
		Long: "A teacher signs in with Firebase like anyone else; the API recognizes them\n" +
			"when the verified email of their token is --email.",
		Example: "  arbol teacher add --email laura@fceia.unr.edu.ar --name 'Laura Méndez' --subject 2 --subject 12",
		Args:    cobra.NoArgs,
		RunE: func(*cobra.Command, []string) error {
			g, err := openDB()
			if err != nil {
				return err
			}
			t, err := addTeacher(g, email, name, faculty, subjects)
			if err != nil {
				return err
			}
			log.Printf("%s -> t-%d (%s), subjects %v", t.Email, t.ID, t.Name, subjects)
			return nil
		},
	}
	add.Flags().StringVar(&email, "email", "", "email the teacher signs in with")
	add.Flags().StringVar(&name, "name", "", "name shown in the app")
	add.Flags().StringVar(&faculty, "faculty", db.Faculty, "faculty of the subjects")
	add.Flags().IntSliceVar(&subjects, "subject", nil, "id of a subject they teach (repeatable)")
	add.MarkFlagRequired("email")
	add.MarkFlagRequired("name")
	cmd.AddCommand(add)
	return cmd
}

// addTeacher creates the teacher with email (or updates its name) and replaces
// the subjects they teach, which must exist in faculty.
func addTeacher(g *gorm.DB, email, name, faculty string, subjects []int) (db.Teacher, error) {
	t := db.Teacher{Email: strings.ToLower(strings.TrimSpace(email)), Name: strings.TrimSpace(name)}
	if t.Email == "" || t.Name == "" {
		return t, fmt.Errorf("email and name are required")
	}
	var found int64
	if err := g.Model(&db.Subject{}).Where("faculty = ? AND id IN ?", faculty, subjects).Count(&found).Error; err != nil {
		return t, err
	}
	if len(subjects) > 0 && int(found) != len(subjects) {
		return t, fmt.Errorf("some of the subjects %v are not in faculty %q (import the plan first)", subjects, faculty)
	}
	err := g.Transaction(func(tx *gorm.DB) error {
		err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "email"}},
			DoUpdates: clause.AssignmentColumns([]string{"name"}),
		}).Create(&t).Error
		if err != nil {
			return err
		}
		if err := tx.First(&t, "email = ?", t.Email).Error; err != nil {
			return err
		}
		if err := tx.Delete(&db.TeacherSubject{}, "teacher_id = ?", t.ID).Error; err != nil {
			return err
		}
		for _, id := range subjects {
			if err := tx.Create(&db.TeacherSubject{TeacherID: t.ID, Faculty: faculty, SubjectID: id}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	return t, err
}
