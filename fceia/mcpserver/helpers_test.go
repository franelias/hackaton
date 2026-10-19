package mcpserver_test

import (
	"sort"
	"strings"
)

func sortedJoin(s []string) string {
	sort.Strings(s)
	return strings.Join(s, " ")
}
