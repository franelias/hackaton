package tools

import (
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// foldRune lowercases r and drops its accent. It maps one rune to one rune so
// indexes in folded text line up with the original.
func foldRune(r rune) rune {
	d := []rune(norm.NFD.String(string(r)))
	return unicode.ToLower(d[0])
}

func foldRunes(s string) []rune {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		out = append(out, foldRune(r))
	}
	return out
}

// fold is the accent- and case-insensitive form used for matching.
func fold(s string) string { return string(foldRunes(s)) }

func containsFolded(haystack, needle string) bool {
	return strings.Contains(fold(haystack), fold(needle))
}

// indexFolded returns the rune index of needle in text, or -1.
func indexFolded(text []rune, needle string) int {
	n := foldRunes(needle)
	if len(n) == 0 {
		return -1
	}
	for i := 0; i+len(n) <= len(text); i++ {
		match := true
		for j := range n {
			if text[i+j] != n[j] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}
