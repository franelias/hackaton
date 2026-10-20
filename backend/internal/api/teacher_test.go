package api

import (
	"testing"

	"firebase.google.com/go/v4/auth"
)

func TestVerifiedEmail(t *testing.T) {
	for _, c := range []struct {
		claims map[string]any
		want   string
	}{
		{map[string]any{"email": " Laura@FCEIA.unr.edu.ar", "email_verified": true}, "laura@fceia.unr.edu.ar"},
		{map[string]any{"email": "laura@fceia.unr.edu.ar", "email_verified": false}, ""},
		{map[string]any{"email": "laura@fceia.unr.edu.ar"}, ""},
		{map[string]any{"email_verified": true}, ""},
	} {
		if got := verifiedEmail(&auth.Token{Claims: c.claims}); got != c.want {
			t.Errorf("verifiedEmail(%v) = %q, want %q", c.claims, got, c.want)
		}
	}
}
