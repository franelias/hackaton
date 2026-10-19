// Package db holds the Postgres schema (goose migrations) and the GORM models.
package db

import (
	"embed"
	"encoding/json"
	"time"

	"github.com/pressly/goose/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Faculty is the only data provider today. Plan tables are keyed by faculty
// so others can be added without id collisions.
const Faculty = "fceia"

//go:embed migrations/*.sql
var migrations embed.FS

func Open(url string) (*gorm.DB, error) {
	return gorm.Open(postgres.Open(url), &gorm.Config{Logger: logger.Default.LogMode(logger.Warn)})
}

func Migrate(g *gorm.DB) error {
	sqlDB, err := g.DB()
	if err != nil {
		return err
	}
	goose.SetBaseFS(migrations)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	return goose.Up(sqlDB, "migrations")
}

type Career struct {
	Faculty      string `gorm:"primaryKey"`
	ID           int    `gorm:"primaryKey;autoIncrement:false"`
	Name         string
	MinTerms     int
	CriticalPath []int `gorm:"serializer:json"`
}

type Subject struct {
	Faculty           string `gorm:"primaryKey"`
	ID                int    `gorm:"primaryKey;autoIncrement:false"`
	CareerID          int
	Code              string
	Name              string
	Year              *int
	Term              *int
	Optional          bool
	Unlocks           []int `gorm:"serializer:json"`
	UnlocksTotal      int
	Bottleneck        bool
	Slack             int
	PostponeYearDelay int
}

type Prerequisite struct {
	Faculty    string `gorm:"primaryKey"`
	SubjectID  int    `gorm:"primaryKey;autoIncrement:false"`
	RequiresID int    `gorm:"primaryKey;autoIncrement:false"`
	Condition  string
}

type Student struct {
	ID          int
	FirebaseUID string
	Name        string
	Faculty     string
	CareerID    int
	CreatedAt   time.Time
}

type StudentSubject struct {
	StudentID int `gorm:"primaryKey;autoIncrement:false"`
	SubjectID int `gorm:"primaryKey;autoIncrement:false"`
	State     string
}

type Activity struct {
	ID        int
	StudentID int
	Type      string
	SubjectID *int
	Topic     *string
	Result    json.RawMessage `gorm:"type:jsonb"`
	Date      *time.Time      `gorm:"type:date"`
	CreatedAt time.Time
}
