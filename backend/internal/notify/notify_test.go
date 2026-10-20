package notify

import (
	"mime"
	"net/mail"
	"strings"
	"testing"

	"github.com/franelias/hackaton/backend/internal/tree"
)

func TestLink(t *testing.T) {
	n := &Notifier{AppURL: "https://arbol.app/"}
	cases := map[string]tree.Action{
		"https://arbol.app/tutor?materia=12": {Type: "open_tutor", SubjectID: new(12)},
		"https://arbol.app/tutor":            {Type: "contact_tutor"},
		"https://arbol.app/horarios":         {Type: "build_schedule"},
		"https://arbol.app/":                 {Type: "view_dates"},
	}
	for want, a := range cases {
		if got := n.link(a); got != want {
			t.Errorf("%+v: got %s, want %s", a, got, want)
		}
	}
}

func TestCompose(t *testing.T) {
	from, _ := mail.ParseAddress("Árbol <recordatorios@arbol.app>")
	m := Message{Title: "🔥 Tu racha está en juego", Body: "Llevás <3> semanas.", URL: "https://arbol.app/tutor"}
	raw, err := compose(from, "beto@arbol.demo", "Beto", m, "https://arbol.app/cuenta")
	if err != nil {
		t.Fatal(err)
	}
	msg, err := mail.ReadMessage(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	subject, err := new(mime.WordDecoder).DecodeHeader(msg.Header.Get("Subject"))
	if err != nil || subject != m.Title {
		t.Errorf("subject %q (%v)", subject, err)
	}
	if msg.Header.Get("To") != "beto@arbol.demo" || !strings.HasPrefix(msg.Header.Get("Content-Type"), "multipart/alternative") {
		t.Errorf("headers %v", msg.Header)
	}
	body := string(raw)
	// the HTML part escapes the text it gets
	if !strings.Contains(body, "&lt;3&gt;") || !strings.Contains(body, "Hola Beto") || !strings.Contains(body, "arbol.app/cuenta") {
		t.Errorf("body:\n%s", body)
	}
}
