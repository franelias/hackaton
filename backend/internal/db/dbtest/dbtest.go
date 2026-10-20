// Package dbtest gives tests a migrated Postgres database of their own.
package dbtest

import (
	"fmt"
	"math/rand/v2"
	"net/url"
	"os"
	"testing"

	"gorm.io/gorm"

	"github.com/franelias/hackaton/backend/internal/db"
)

// New creates an empty, migrated database on the server of TEST_DATABASE_URL
// and drops it when the test ends. The test is skipped when the variable is
// not set, so `go test ./...` needs no database.
func New(t *testing.T) *gorm.DB {
	t.Helper()
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	admin, err := db.Open(raw)
	if err != nil {
		t.Fatal(err)
	}
	name := fmt.Sprintf("arbol_test_%d", rand.Uint32())
	if err := admin.Exec("CREATE DATABASE " + name).Error; err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	g, err := db.Open(u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if sqlDB, err := g.DB(); err == nil {
			sqlDB.Close()
		}
		admin.Exec("DROP DATABASE " + name + " WITH (FORCE)")
		if sqlDB, err := admin.DB(); err == nil {
			sqlDB.Close()
		}
	})
	if err := db.Migrate(g); err != nil {
		t.Fatal(err)
	}
	return g
}
