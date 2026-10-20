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

// FacultyNames are the names students see when picking their faculty.
var FacultyNames = map[string]string{
	Faculty: "Facultad de Ciencias Exactas, Ingeniería y Agrimensura (UNR)",
}

//go:embed migrations/*.sql
var migrations embed.FS

func Open(url string) (*gorm.DB, error) {
	g, err := gorm.Open(postgres.Open(url), &gorm.Config{Logger: logger.Default.LogMode(logger.Warn)})
	if err != nil {
		return nil, err
	}
	// Keep connections open: to a remote database (Supabase) opening one takes
	// about 2 seconds, and database/sql keeps only 2 idle by default. The cap
	// stays under the pooler's client limit.
	sqlDB, err := g.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(10)
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetConnMaxIdleTime(10 * time.Minute)
	return g, nil
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
	NotifyPush  bool `gorm:"default:true"`
	NotifyEmail bool `gorm:"default:true"`
	CreatedAt   time.Time
}

type StudentSubject struct {
	StudentID int `gorm:"primaryKey;autoIncrement:false"`
	SubjectID int `gorm:"primaryKey;autoIncrement:false"`
	State     string
	Since     time.Time // when it got this state
	Grade     *int      // the final's grade, only while approved
}

// FailedExam is a failed final (aplazo).
type FailedExam struct {
	ID        int
	StudentID int
	SubjectID int
	Grade     int
	CreatedAt time.Time
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

type Period struct {
	ID      int
	Faculty string
	Kind    string // recess | exams
	Label   string
	Starts  time.Time `gorm:"type:date"`
	Ends    time.Time `gorm:"type:date"`
}

type Alert struct {
	ID        int
	StudentID int
	Type      string
	SubjectID *int
	Level     string
	Message   string
	Action    json.RawMessage `gorm:"type:jsonb"`
	CondKey   string
	Dismissed bool
	CreatedAt time.Time
}

type Conversation struct {
	ID            int
	StudentID     int
	MockSubjectID *int
	MockMinutes   *int
	MockStartedAt *time.Time
	CreatedAt     time.Time
}

type ConversationMessage struct {
	ID             int
	ConversationID int
	Role           string
	Content        json.RawMessage `gorm:"type:jsonb"`
	Text           *string
	CreatedAt      time.Time
}

type Teacher struct {
	ID        int
	Email     string
	Name      string
	CreatedAt time.Time
}

type TeacherSubject struct {
	TeacherID int    `gorm:"primaryKey;autoIncrement:false"`
	Faculty   string `gorm:"primaryKey"`
	SubjectID int    `gorm:"primaryKey;autoIncrement:false"`
}

type PushToken struct {
	Token     string `gorm:"primaryKey"`
	StudentID int
	CreatedAt time.Time
}

type Notification struct {
	ID        int
	StudentID int
	Kind      string
	SubjectID *int
	CondKey   string
	Title     string
	Body      string
	SentAt    time.Time `gorm:"default:now()"`
}
